// The catalogues the covers and the metadata come from, fast and with many requests allowed: Open Library (search and
// covers by id), Goodreads (the suggestions of its search box: title, author, series, the picture of the edition),
// Apple Books (the iTunes search for e-books, artwork scaled up to 900 px), the Deutsche Nationalbibliothek (the SRU
// catalogue in MARC21 and the cover service by ISBN), the Internet Archive (its catalogue of books, the scanned cover of
// a copy) and Google Books (keyless requests currently get no quota at all, so without a key of the reader's it rests for
// half a day after such an answer). Amazon's pictures of an edition come by its ISBN-10 or ASIN, for records that
// name one. Each answer becomes a list of records in one shape (see `record` below); book-match.js decides which of them
// is the book.
//
// Every host is asked politely: a few requests at a time at most, a pause between two requests (Apple: 18 a minute),
// retries with growing pauses after a network error, and a rest after "too many requests" (Retry-After, else a minute,
// doubled each time). Only title, author and ISBN of a book are ever sent.
'use strict';
const { normLang, textLanguage, isbn13, isbn10, isbnList, seriesNumber, seriesName, personName, splitNames, yearOf } = require('./book-match');

const UA = 'CozyShelves/0.7 (personal library app)';
// per host: requests at once, the pause between two starts, at most n in a window of ms
const HOSTS = {
  'openlibrary.org': { conc: 1, gap: 1000 },
  'covers.openlibrary.org': { conc: 2, gap: 250 },
  'archive.org': { conc: 2, gap: 500 },
  'itunes.apple.com': { conc: 1, gap: 3100, window: [18, 60e3] },
  'mzstatic.com': { conc: 2, gap: 100 },
  'services.dnb.de': { conc: 1, gap: 1000 },
  'portal.dnb.de': { conc: 1, gap: 500 },
  'www.googleapis.com': { conc: 1, gap: 1000 },
  'books.google.com': { conc: 2, gap: 300 },
  'www.goodreads.com': { conc: 1, gap: 1000 },
  'i.gr-assets.com': { conc: 3, gap: 100 },
  'images-na.ssl-images-amazon.com': { conc: 3, gap: 100 },
  'm.media-amazon.com': { conc: 3, gap: 100 },
  // the image search engines (image-engines.js): their searches with a small budget, their image caches freely
  'www.bing.com': { conc: 1, gap: 4000, window: [8, 60e3] },
  'bing.net': { conc: 4, gap: 50 },
  'yandex.com': { conc: 1, gap: 20000, window: [2, 60e3] },
  'avatars.mds.yandex.net': { conc: 3, gap: 100 },
  '*': { conc: 2, gap: 300 },
};
const RETRIES = 2;                   // after a network error or a timeout
const REST = 60e3, REST_MAX = 30 * 60e3, QUOTA_REST = 12 * 3600e3;
const DAY = 24 * 3600e3;              // a sign of throttling counts for so long after its rest (longer rests, smaller budget)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The HOSTS entry of an address ("is1-ssl.mzstatic.com" → 'mzstatic.com'). */
function hostKey(url) {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase(); } catch { return '*'; }
  if (HOSTS[h]) return h;
  for (const k of Object.keys(HOSTS)) if (k !== '*' && h.endsWith('.' + k)) return k;
  return '*';
}

class HostError extends Error {
  constructor(msg, code, status = 0) { super(msg); this.code = code; this.status = status; }
}

/**
 * Requests, host by host. `fetch(url, { headers, timeout, maxBytes })` → { ok, status, contentType, buffer, headers? };
 * `pace` scales every pause (0 in test runs with saved answers); `rests` keeps the rests of the hosts across restarts
 * (a plain object the caller stores).
 */
class Net {
  constructor({ fetch, now = () => Date.now(), log = console, pace = 1, rests = {} }) {
    this.fetch = fetch; this.now = now; this.log = log; this.pace = pace; this.rests = rests;
    this.hosts = new Map();
    this.count = 0;
  }
  host(k) {
    let h = this.hosts.get(k);
    if (!h) this.hosts.set(k, h = { conf: HOSTS[k] || HOSTS['*'], active: 0, last: 0, recent: [], waiting: [], strikes: 0 });
    return h;
  }
  /** Milliseconds until a host may be asked again after it said "too many requests" (0: now). */
  resting(url) { const r = this.rests[hostKey(url)]; return r && r.until > this.now() ? r.until - this.now() : 0; }
  /** Milliseconds until a request to the host of `url` could start: its rest, its pause, its budget of the minute. */
  wait(url) {
    const k = hostKey(url), h = this.host(k), c = h.conf;
    let w = this.resting(url);
    if (h.active >= c.conc) w = Math.max(w, 50);
    w = Math.max(w, h.last + Math.round(c.gap * this.pace) - this.now());
    if (c.window && this.pace) {
      const n = this.budget(k), ms = c.window[1];
      const recent = h.recent.filter((t) => this.now() - t < ms);
      if (recent.length >= n) w = Math.max(w, recent[recent.length - n] + ms - this.now());
    }
    return Math.max(0, w);
  }
  /**
   * A host showed signs of throttling (a captcha, a challenge): it rests, twice as long as the last time when that was
   * less than a day ago (`base` doubled, `max` at most), and its budget is halved for the day after (see budget). The
   * count lives in `rests` and survives a restart.
   */
  rest(url, base, max, why) {
    const k = hostKey(url);
    const prev = this.rests[k];
    const n = prev && this.now() - prev.until < DAY ? (prev.n || 0) + 1 : 1;
    const ms = Math.min(max, base * 2 ** (n - 1));
    this.rests[k] = { until: this.now() + ms, why, n };
    this.log.warn?.(`[covers] ${k}: ${why}, resting ${Math.round(ms / 60e3)} min`);
    return ms;
  }
  /** The requests a host allows in its window: its budget, halved for every sign of throttling within a day. */
  budget(k) {
    const c = this.host(k).conf, r = this.rests[k];
    if (!c.window) return Infinity;
    const n = r && r.n && this.now() - r.until < DAY ? r.n : 0;
    return Math.max(1, Math.floor(c.window[0] / 2 ** n));
  }
  async slot(k) {
    const h = this.host(k);
    for (;;) {
      if (this.rests[k]?.until > this.now()) throw new HostError(k + ' is resting', 'rest');
      const c = h.conf;
      const gap = Math.round(c.gap * this.pace);
      let wait = h.active >= c.conc ? 50 : Math.max(0, h.last + gap - this.now());
      if (!wait && c.window && this.pace) {
        const n = this.budget(k), ms = c.window[1];
        h.recent = h.recent.filter((t) => this.now() - t < ms);
        if (h.recent.length >= n) wait = ms - (this.now() - h.recent[0]) + 10;
      }
      if (wait <= 0) break;
      await sleep(Math.min(wait, 1000));
    }
    h.active++; h.last = this.now(); h.recent.push(h.last); h.count = (h.count || 0) + 1;
    return () => { h.active--; };
  }
  /**
   * GET with the host's manners. Resolves with the answer (also a 404); throws HostError ('offline', 'timeout', 'rest',
   * 'busy' for 429/503) when the host could not be asked.
   */
  async get(url, { timeout = 15000, maxBytes = 4 << 20, accept = '*/*', retries = RETRIES, headers = null } = {}) {
    const k = hostKey(url);
    for (let attempt = 0; ; attempt++) {
      const done = await this.slot(k);
      let r = null, err = null;
      try { this.count++; r = await this.fetch(url, { headers: { 'User-Agent': UA, Accept: accept, ...(headers || {}) }, timeout, maxBytes }); }
      catch (e) { err = e; }
      finally { done(); }
      if (r && (r.status === 429 || r.status === 503)) {
        const h = this.host(k);
        h.strikes++;
        const body = r.buffer ? r.buffer.toString('utf8', 0, Math.min(r.buffer.length, 4000)) : '';
        // Google without a key: "Quota exceeded … Queries per day" (a quota of 0 for keyless requests)
        const quota = /quota|per day|RESOURCE_EXHAUSTED/i.test(body);
        const after = (parseInt(r.retryAfter || '', 10) || 0) * 1000;
        const rest = quota ? QUOTA_REST : Math.min(REST_MAX, Math.max(after, REST * 2 ** (h.strikes - 1)));
        this.rests[k] = { until: this.now() + rest, why: quota ? 'quota' : String(r.status) };
        this.log.warn?.(`[covers] ${k} says ${r.status}${quota ? ' (quota)' : ''}, resting ${Math.round(rest / 60e3)} min`);
        throw new HostError(k + ' busy', 'busy', r.status);
      }
      if (r && r.status >= 500 && attempt < 1) { await sleep(2000 * this.pace); continue; }
      if (r) { this.host(k).strikes = 0; return r; }
      const msg = (err && err.message) || String(err);
      if (attempt < retries && !/too large/.test(msg)) { await sleep((1500 + 2500 * attempt + Math.random() * 500) * this.pace); continue; }
      throw new HostError(msg, /timeout/i.test(msg) ? 'timeout' : 'offline');
    }
  }
  async json(url, opts = {}) {
    const r = await this.get(url, { accept: 'application/json', ...opts });
    if (!r.ok) return { status: r.status, data: null };
    try { return { status: r.status, data: JSON.parse(r.buffer.toString('utf8')) }; } catch { return { status: r.status, data: null }; }
  }
}

// ---------------------------------------------------------------- the records ----------------------------------------
/**
 * One catalogue record:
 *   { source, id, title, subtitle, authors[], isbns[] (13 digits), isbnOwn (this edition's), language, year, publisher,
 *     series, seriesIndex, kind ('book'|'ebook'|'audio'|'video'|'other'),
 *     cover: { url, preview, maybe (the host answers 404 when it has none) } | null, page (the record on the web) }
 */
function record(o) {
  return {
    source: o.source, id: o.id ?? null, title: String(o.title || '').trim(), subtitle: String(o.subtitle || '').trim() || null,
    authors: (o.authors || []).map((a) => String(a || '').trim()).filter(Boolean), isbns: isbnList(o.isbns || []),
    isbnOwn: o.isbnOwn ? isbn13(o.isbnOwn) : null, language: normLang(o.language), year: o.year ?? null, publisher: o.publisher || null,
    series: o.series || null, seriesIndex: Number.isFinite(o.seriesIndex) ? o.seriesIndex : null, kind: o.kind || 'book',
    cover: o.cover || null, page: o.page || null, asin: o.asin || null,
  };
}

// ---------------------------------------------------------------- Open Library ---------------------------------------
const OL_FIELDS = 'key,title,subtitle,author_name,cover_i,language,first_publish_year,edition_count,editions,editions.key,editions.title,editions.subtitle,editions.cover_i,editions.isbn,editions.language,editions.publisher,editions.publish_date';
const olCover = (id) => (id ? { url: `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`, preview: `https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false` } : null);
/** search.json: a title (q, which also finds the titles of editions), an author, the language whose edition comes first; or an ISBN. */
function olUrl({ title, author, lang, isbn }) {
  const p = new URLSearchParams();
  if (isbn) p.set('isbn', isbn);
  else { p.set('q', String(title || '').slice(0, 150)); if (author) p.set('author', String(author).slice(0, 60)); }
  if (lang) p.set('lang', lang);
  p.set('limit', '6'); p.set('fields', OL_FIELDS);
  return 'https://openlibrary.org/search.json?' + p;
}
/** A work (its first edition's cover, all its languages) and the edition the search put first for the language. */
function parseOpenLibrary(data) {
  const out = [];
  for (const d of data?.docs || []) {
    const langs = d.language || [];
    out.push(record({ source: 'openlibrary', id: d.key, title: d.title, subtitle: d.subtitle, authors: d.author_name, language: langs.length === 1 ? langs[0] : null,
      year: d.first_publish_year, cover: olCover(d.cover_i), page: d.key ? 'https://openlibrary.org' + d.key : null }));
    const e = d.editions?.docs?.[0];
    if (e && e.title) {
      const isbns = isbnList(e.isbn || []);
      out.push(record({ source: 'openlibrary', id: e.key, title: e.title, subtitle: e.subtitle, authors: d.author_name, isbns, isbnOwn: isbns[0] || null,
        language: (e.language || [])[0] || null, year: (e.publish_date || [])[0] || null, publisher: (e.publisher || [])[0] || null,
        cover: olCover(e.cover_i), page: e.key ? 'https://openlibrary.org' + e.key : null }));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Apple Books ---------------------------------------
const appleArt = (u, size) => String(u || '').replace(/\/\d+x\d+bb\.(?:jpg|png|webp)$/i, `/${size}x${size}bb.jpg`);
function appleUrl({ title, author, lang, isbns }) {
  const country = lang === 'de' ? 'de' : 'us';
  if (isbns?.length) return `https://itunes.apple.com/lookup?${new URLSearchParams({ isbn: isbns.slice(0, 3).join(','), country })}`;
  const term = [title, author ? String(author).split(/[,;&]/)[0] : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 150);
  return 'https://itunes.apple.com/search?' + new URLSearchParams({ term, media: 'ebook', entity: 'ebook', limit: '8', country, lang: country === 'de' ? 'de_de' : 'en_us' });
}
/** E-books of the Apple Books store: the artwork (its file name is often the e-book's ISBN), the language of the blurb. */
function parseApple(data) {
  const out = [];
  for (const r of data?.results || []) {
    if (r.kind && r.kind !== 'ebook') continue;
    const art = r.artworkUrl100 || r.artworkUrl60 || '';
    const fileIsbn = isbn13((/\/(97[89]\d{10})\.[a-z]+\/\d+x\d+bb\./i.exec(art) || [])[1]);
    const name = String(r.trackName || '');
    const cut = /^(.{3,}?):\s+(.+)$/.exec(name);
    out.push(record({ source: 'apple', id: r.trackId, title: cut ? cut[1] : name, subtitle: cut ? cut[2] : null, authors: splitNames(r.artistName || ''),
      isbns: fileIsbn ? [fileIsbn] : [], isbnOwn: fileIsbn, language: textLanguage(r.description), year: r.releaseDate || null, kind: 'ebook',
      cover: art ? { url: appleArt(art, 900), preview: appleArt(art, 200) } : null, page: String(r.trackViewUrl || '').replace(/\?.*$/, '') || null }));
  }
  return out;
}

// ---------------------------------------------------------------- Deutsche Nationalbibliothek -----------------------
/** CQL words: letters, digits and hyphens; the operators "and", "or", "not", "prox" would end the query. */
const cqlWords = (s) => String(s || '').normalize('NFC').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w && !/^(?:and|or|not|prox)$/i.test(w)).join(' ');
function dnbUrl({ title, author, isbn }) {
  let query;
  if (isbn) query = 'num=' + isbn;
  else {
    query = 'tit=' + cqlWords(title).slice(0, 150);
    const sur = String(author || '').split(/[,;&]/)[0].trim().split(/\s+/).pop();
    if (sur && cqlWords(sur)) query += ' and per=' + cqlWords(sur);
  }
  return 'https://services.dnb.de/sru/dnb?' + new URLSearchParams({ version: '1.1', operation: 'searchRetrieve', query, recordSchema: 'MARC21-xml', maximumRecords: '8' });
}
const dnbCover = (isbn) => (isbn ? { url: `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}`, preview: `https://portal.dnb.de/opac/mvb/cover?isbn=${isbn}&size=m`, maybe: true } : null);
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unxml = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : XML_ENT[e.toLowerCase()]));
/** The data fields of one MARC21-xml record: tag → [{ ind2, sub: { code: [values] } }]. */
function marcFields(xml) {
  const f = {};
  const re = /<datafield tag="(\d{3})" ind1="(.)" ind2="(.)">([\s\S]*?)<\/datafield>/g;
  let m;
  while ((m = re.exec(xml))) {
    const sub = {};
    const r2 = /<subfield code="(.)">([^<]*)<\/subfield>/g;
    let k;
    while ((k = r2.exec(m[4]))) (sub[k[1]] = sub[k[1]] || []).push(unxml(k[2]).replace(/[\u0098\u009c]/g, '').trim());
    (f[m[1]] = f[m[1]] || []).push({ ind2: m[3], sub });
  }
  return f;
}
const first = (f, tag, code) => f[tag]?.map((x) => x.sub[code]?.[0]).find(Boolean) || null;
/** The records of an SRU answer: title (245 a, n, p; subtitle b), authors (100, 700 as author), ISBNs (020), year and publisher (264, 260), series (490, 830, 800), language (041, 008), kind (leader 6, 338). */
function parseDnb(xml) {
  const out = [];
  for (const chunk of String(xml || '').split('<recordData>').slice(1)) {
    const leader = (/<leader>([^<]*)</.exec(chunk) || [])[1] || '';
    const c008 = unxml((/<controlfield tag="008">([^<]*)</.exec(chunk) || [])[1] || '');
    const id = (/<controlfield tag="001">([^<]*)</.exec(chunk) || [])[1] || null;
    const f = marcFields(chunk);
    const t = f['245']?.[0]?.sub || {};
    const title = [t.a?.[0], t.n?.[0] && t.p?.[0] ? null : t.n?.[0]].filter(Boolean).join(' ').replace(/\s*[/:;=]\s*$/, '');
    const subtitle = [t.p?.[0], t.b?.[0]].filter(Boolean).join(' : ').replace(/\s*[/:;=]\s*$/, '') || null;
    const type = leader[6] || 'a';
    const form = (f['338'] || []).map((x) => x.sub.a?.[0] || '').join(' ');
    const kind = type === 'i' || type === 'j' ? 'audio' : type === 'g' ? 'video' : type === 'a' || type === 't' ? (/online/i.test(form) ? 'ebook' : 'book') : 'other';
    const authors = [...(f['100'] || []), ...(f['700'] || []).filter((x) => (x.sub['4'] || []).includes('aut'))].map((x) => personName(x.sub.a?.[0] || '')).filter(Boolean);
    const isbns = isbnList((f['020'] || []).map((x) => x.sub.a?.[0]));
    const pub = (f['264'] || []).find((x) => x.ind2 === '1') || (f['264'] || [])[0] || (f['260'] || [])[0];
    // "[2025]", "c2017"; a catalogue's "25" says nothing, the date in field 008 does
    const year = yearOf(pub?.sub.c?.[0]) || yearOf(c008.slice(7, 11)) || null;
    const ser = [...(f['490'] || []).map((x) => [x.sub.a?.[0], x.sub.v?.[0]]), ...(f['830'] || []).map((x) => [x.sub.a?.[0], x.sub.v?.[0]]), ...[...(f['800'] || []), ...(f['810'] || [])].map((x) => [x.sub.t?.[0], x.sub.v?.[0]])].find((s) => s[0]);
    const lang = first(f, '041', 'a') || c008.slice(35, 38).trim();
    out.push(record({ source: 'dnb', id, title, subtitle, authors, isbns, isbnOwn: isbns[0] || null, language: lang, year, publisher: pub?.sub.b?.[0] || null,
      series: ser ? seriesName(ser[0]) : null, seriesIndex: ser ? seriesNumber(ser[1]) : null, kind, cover: dnbCover(isbns[0]), page: id ? `https://d-nb.info/${id}` : null }));
  }
  return out;
}

// ---------------------------------------------------------------- Google Books --------------------------------------
/** `key`: the reader's own API key (settings googleBooksKey), when there is one. */
function googleUrl({ title, author, lang, isbn, key }) {
  const q = isbn ? 'isbn:' + isbn : ['intitle:' + String(title || '').slice(0, 120), author ? 'inauthor:' + String(author).split(/[,;&]/)[0].slice(0, 60) : ''].filter(Boolean).join(' ');
  const p = new URLSearchParams({ q, maxResults: '8', printType: 'books' });
  if (lang && !isbn) p.set('langRestrict', lang);
  if (key) p.set('key', String(key).trim());
  return 'https://www.googleapis.com/books/v1/volumes?' + p;
}
const googleImage = (u, large) => {
  let s = String(u || '').replace(/^http:/, 'https:').replace(/&edge=curl/, '');
  if (large) s = s.replace(/&zoom=\d/, '&zoom=1') + '&fife=w800-h1200';
  return s;
};
function parseGoogle(data) {
  const out = [];
  for (const it of data?.items || []) {
    const v = it.volumeInfo || {};
    const isbns = isbnList((v.industryIdentifiers || []).filter((x) => /ISBN/.test(x.type)).map((x) => x.identifier));
    const thumb = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
    const ser = v.seriesInfo?.volumeSeries?.[0];
    out.push(record({ source: 'google', id: it.id, title: v.title, subtitle: v.subtitle, authors: v.authors, isbns, isbnOwn: isbns[0] || null, language: v.language,
      year: v.publishedDate || null, publisher: v.publisher || null, seriesIndex: ser ? seriesNumber(ser.orderNumber) : null,
      kind: v.printType && v.printType !== 'BOOK' ? 'other' : 'book', cover: thumb ? { url: googleImage(thumb, true), preview: googleImage(thumb, false) } : null,
      page: v.canonicalVolumeLink || v.infoLink || null }));
  }
  return out;
}

// ---------------------------------------------------------------- Goodreads -------------------------------------------
/**
 * The suggestions of Goodreads' search box: a title, an ISBN or an ASIN. The title alone: with the author's name the box
 * suggests books about the author (study guides, "The Art of Walden by Henry David Thoreau") before the book itself.
 */
function goodreadsUrl({ title, isbn, asin }) {
  const q = isbn || asin || String(title || '').replace(/\s+/g, ' ').trim().slice(0, 150);
  return 'https://www.goodreads.com/book/auto_complete?' + new URLSearchParams({ format: 'json', q });
}
/** A Goodreads picture in its full size (the suggestions carry a small one, "…._SY75_.jpg"), or in a height; none for "nophoto". */
function goodreadsImage(u, height = 0) {
  const s = String(u || '');
  if (!/^https:\/\//.test(s) || /nophoto/i.test(s)) return null;
  const base = s.replace(/\._S[XY]\d+_(?=\.(?:jpe?g|png|webp)$)/i, '');
  return height ? base.replace(/\.(jpe?g|png|webp)$/i, `._SY${height}_.$1`) : base;
}
/**
 * Goodreads' suggestions: per work the edition its search put first, the series in the title ("Die zwei Türme (Der Herr
 * der Ringe, #2)"). An ISBN or ASIN asked for belongs to the first one.
 */
function parseGoodreads(data, { isbn = null, asin = null } = {}) {
  const out = [];
  (Array.isArray(data) ? data : []).slice(0, 8).forEach((d, i) => {
    const full = String(d.title || '').replace(/\s+/g, ' ').trim();
    const ser = /\(([^()#]+?),?\s*#\s*([\d.]+)\)\s*$/.exec(full);
    const author = d.author?.name ? String(d.author.name).replace(/\s+/g, ' ').trim() : '';
    const surname = author.split(' ').pop();
    const title = String(d.bookTitleBare || full).replace(/\s+/g, ' ').replace(/\s*\((?:german|english|french|spanish|italian|deutsche?|kindle)(?: edition| ausgabe)?\)\s*$/i, '')
      // "Der Schimmelreiter by Theodor Storm": the author is no part of the title
      .replace(/\s+(?:by|von)\s+([^,()]+)$/i, (m, who) => (surname && who.toLowerCase().includes(surname.toLowerCase()) ? '' : m)).trim();
    const url = goodreadsImage(d.imageUrl);
    const own = i === 0 ? isbn13(isbn) : null;
    out.push(record({ source: 'goodreads', id: d.bookId ? String(d.bookId) : null, title, authors: author ? [author] : [], isbns: own ? [own] : [], isbnOwn: own,
      series: ser ? seriesName(ser[1]) : null, seriesIndex: ser ? seriesNumber(ser[2]) : null, cover: url ? { url, preview: goodreadsImage(d.imageUrl, 300) } : null,
      page: d.bookId ? 'https://www.goodreads.com/book/show/' + d.bookId : null, asin: i === 0 ? asin : null }));
  });
  return out;
}

// ---------------------------------------------------------------- Amazon ----------------------------------------------
/** Amazon's picture of an edition by its ISBN-10 or ASIN, about 500 px tall (a 1 × 1 GIF when it has none). */
function amazonCover(isbnOrAsin) {
  const id = /^B0[0-9A-Z]{8}$/.test(String(isbnOrAsin || '')) ? isbnOrAsin : isbn10(isbnOrAsin);
  if (!id) return null;
  const url = `https://m.media-amazon.com/images/P/${id}.01._SCLZZZZZZZ_.jpg`;
  return { url, preview: url, maybe: true };
}

// ---------------------------------------------------------------- the Internet Archive -------------------------------
const luceneWords = (s) => cqlWords(s).replace(/[:()"\\[\]{}~^!*?+-]/g, ' ').replace(/\s+/g, ' ').trim();
/** The Archive's catalogue of texts: title words and the author's surname, or an ISBN. */
function archiveUrl({ title, author, isbn }) {
  let q;
  if (isbn) q = `isbn:(${isbn13(isbn) || ''})`;
  else {
    q = `title:(${luceneWords(title).slice(0, 120)})`;
    const sur = luceneWords(String(author || '').split(/[,;&]/)[0].trim().split(/\s+/).pop() || '');
    if (sur) q += ` AND creator:(${sur})`;
  }
  const p = new URLSearchParams({ q: q + ' AND mediatype:(texts)', rows: '8', output: 'json' });
  for (const f of ['identifier', 'title', 'creator', 'date', 'language', 'isbn', 'publisher']) p.append('fl[]', f);
  return 'https://archive.org/advancedsearch.php?' + p;
}
/** The scanned cover of a copy, 600 px wide (the small picture of the item for the choice in the book info). */
const archiveCover = (id) => (id ? { url: `https://archive.org/download/${encodeURIComponent(id)}/page/cover_w600.jpg`, preview: `https://archive.org/services/img/${encodeURIComponent(id)}`, maybe: true } : null);
/** "Fontane, Theodor 1819-1898 VerfasserIn" → "Fontane, Theodor" (years of life and roles out). */
const archiveCreator = (c) => String(c || '').replace(/\b\d{3,4}\s*-\s*(?:\d{3,4})?(?=\s|$)|\b(?:verfasser(?:in)?|autor(?:in)?|author|editor|hrsg\.?|herausgeber(?:in)?|übersetzer(?:in)?|translator)\b/gi, ' ').replace(/[\s,.;]+$/, '').replace(/\s+/g, ' ').trim();
function parseArchive(data) {
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return (data?.response?.docs || []).slice(0, 8).map((d) => {
    const isbns = isbnList(arr(d.isbn));
    return record({ source: 'archive', id: d.identifier, title: arr(d.title)[0], authors: arr(d.creator).map((c) => personName(archiveCreator(c))).filter(Boolean), isbns, isbnOwn: isbns[0] || null,
      language: arr(d.language)[0] || null, year: d.date || null, publisher: arr(d.publisher)[0] || null, cover: archiveCover(d.identifier),
      page: d.identifier ? 'https://archive.org/details/' + d.identifier : null });
  });
}

// ---------------------------------------------------------------- the sources -----------------------------------------
/**
 * The catalogues with one interface: `source.search(query)` → { answered, records, error }. `query`: { title, author,
 * lang, isbn, isbns }. answered: the catalogue replied (also with nothing); false when it could not be asked.
 */
function makeSources(net) {
  const ask = async (url, parse, { xml = false } = {}) => {
    try {
      if (xml) {
        const r = await net.get(url, { accept: 'application/xml', maxBytes: 3 << 20 });
        return { answered: true, records: r.ok ? parse(r.buffer.toString('utf8')) : [], status: r.status };
      }
      const { status, data } = await net.json(url, { maxBytes: 2 << 20 });
      return { answered: status > 0 && status < 500, records: data ? parse(data) : [], status };
    } catch (e) { return { answered: false, records: [], error: e.code || e.message }; }
  };
  // each: the questions it answers (an ISBN, an ASIN, a title), where its answers come from (for the wait of its host)
  return {
    openlibrary: { name: 'openlibrary', by: ['isbn', 'title'], host: 'https://openlibrary.org/search.json', search: (q) => ask(olUrl({ title: q.title, author: q.author, lang: q.lang, isbn: q.isbn }), parseOpenLibrary) },
    goodreads: { name: 'goodreads', by: ['isbn', 'asin', 'title'], host: 'https://www.goodreads.com/book/auto_complete', search: (q) => ask(goodreadsUrl(q), (d) => parseGoodreads(d, { isbn: q.isbn, asin: q.asin })) },
    apple: { name: 'apple', by: ['isbn', 'title'], host: 'https://itunes.apple.com/search', search: (q) => ask(appleUrl({ title: q.title, author: q.author, lang: q.lang, isbns: q.isbns }), parseApple) },
    dnb: { name: 'dnb', by: ['isbn', 'title'], host: 'https://services.dnb.de/sru/dnb', search: (q) => ask(dnbUrl({ title: q.title, author: q.author, isbn: q.isbn }), parseDnb, { xml: true }) },
    archive: { name: 'archive', by: ['isbn', 'title'], host: 'https://archive.org/advancedsearch.php', search: (q) => ask(archiveUrl({ title: q.title, author: q.author, isbn: q.isbn }), parseArchive) },
    google: { name: 'google', by: ['isbn', 'title'], host: 'https://www.googleapis.com/books/v1/volumes', search: (q) => ask(googleUrl({ title: q.title, author: q.author, lang: q.lang, isbn: q.isbn, key: q.key }), parseGoogle) },
  };
}

/** Width and height of a JPEG, PNG, GIF or WebP from its first bytes (tests and the recording of answers); null if unknown. */
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  if (buf.toString('latin1', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'gif' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), type: 'webp' };
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: 'webp' };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff), type: 'webp' }; }
    return null;
  }
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const m = buf[o + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5), type: 'jpeg' };
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    o += 2 + buf.readUInt16BE(o + 2);
  }
  return null;
}

module.exports = {
  Net, HostError, HOSTS, hostKey, UA, makeSources, record, imageSize,
  olUrl, parseOpenLibrary, appleUrl, appleArt, parseApple, dnbUrl, parseDnb, dnbCover, marcFields, cqlWords, googleUrl, parseGoogle, unxml,
  goodreadsUrl, goodreadsImage, parseGoodreads, amazonCover, archiveUrl, archiveCover, archiveCreator, parseArchive,
};
