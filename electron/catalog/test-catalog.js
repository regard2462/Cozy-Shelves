// Fixture tests for the online catalog: parsers, sources (with a fake network), readable extraction,
// EPUB builder, download logic and the IPC surface.  Run:  node electron/catalog/test-catalog.js
// Plain Node – no Electron, no network.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');

const X = require('./xml');
const { parseOpds } = require('./opds');
const epub = require('./epub');
const readable = require('./readable');
const download = require('./download');
const sources = require('./sources');
const { createCatalog, register } = require('./index');

const FX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}

// --- fake network -----------------------------------------------------------------------------------
const ROUTES = [
  [/gutendex\.com\/books/, 'gutendex.json', 'application/json'],
  [/standardebooks\.org\/feeds\/opds/, 'standardebooks-opds.xml', 'application/atom+xml'],
  [/standardebooks\.org\/ebooks\?/, 'standardebooks-search.html', 'text/html'],
  [/wikisource\.org\/w\/api\.php\?.*list=search/, 'wikisource-search.json', 'application/json'],
  [/wikibooks\.org\/w\/api\.php\?.*list=search/, 'wikibooks-search.json', 'application/json'],
  [/wiki(source|books)\.org\/w\/api\.php\?.*prop=pageimages/, 'mediawiki-enrich.json', 'application/json'],
  [/wiki(source|books)\.org\/w\/api\.php\?.*list=categorymembers/, 'mediawiki-category.json', 'application/json'],
  [/wiki(source|books)\.org\/w\/api\.php\?.*list=random/, 'mediawiki-random.json', 'application/json'],
  [/wikibooks\.org\/w\/api\.php\?.*list=prefixsearch/, 'wikibooks-prefix.json', 'application/json'],
  [/wikisource\.org\/w\/api\.php\?.*list=prefixsearch/, () => ({ query: { prefixsearch: [] } }), 'application/json'],
  [/wikisource\.org\/api\/rest_v1\/page\/html\//, 'wikisource-page.html', 'text/html'],
  [/wikibooks\.org\/api\/rest_v1\/page\/html\/Schach$|Schach\?redirect/, 'wikibooks-page.html', 'text/html'],
  [/wikibooks\.org\/api\/rest_v1\/page\/html\/Schach%2F/, 'wikibooks-chapter.html', 'text/html'],
  [/archive\.org\/advancedsearch/, 'archive-search.json', 'application/json'],
  [/archive\.org\/metadata\//, 'archive-metadata.json', 'application/json'],
  [/openlibrary\.org\/search\.json/, 'openlibrary-search.json', 'application/json'],
  [/library\.oapen\.org\/rest\/search/, 'oapen-search.json', 'application/json'],
  [/directory\.doabooks\.org\/rest\/search/, 'doab-search.json', 'application/json'],
  [/librivox\.org\/api\/feed\/audiobooks/, 'librivox.json', 'application/json'],
  [/export\.arxiv\.org\/api\/query/, 'arxiv.xml', 'application/atom+xml'],
  [/archive\.org\/download\/[^/]+\/[^/]+_djvu\.txt/, 'archive-djvu.txt', 'text/plain'],
  [/projekt-gutenberg\.org\/bibliothek\/meistgelesen/, 'pgde-lib-meistgelesen.html', 'text/html'],
  [/projekt-gutenberg\.org\/bibliothek\/\?gl_letter=[DVM]/, 'pgde-lib-d.html', 'text/html'],
  [/projekt-gutenberg\.org\/bibliothek\/\?gl_letter=/, () => '<html><body><p>0 Bücher</p></body></html>', 'text/html'],
  [/projekt-gutenberg\.org\/autoren\/\?gl_letter=K/, 'pgde-autoren-k.html', 'text/html'],
  [/projekt-gutenberg\.org\/autoren\//, () => '<html><body><p>0 Autoren</p></body></html>', 'text/html'],
  [/projekt-gutenberg\.org\/authors\/franz-kafka\/?$/, 'pgde-author-kafka.html', 'text/html'],
  [/projekt-gutenberg\.org\/authors\/franz-kafka\/books\/die-verwandlung\/chapter\/1/, 'pgde-chapter1.html', 'text/html'],
  [/projekt-gutenberg\.org\/authors\/franz-kafka\/books\/die-verwandlung\/chapter\/2/, 'pgde-chapter2.html', 'text/html'],
  [/projekt-gutenberg\.org\/authors\/franz-kafka\/books\/die-verwandlung\/?$/, 'pgde-book.html', 'text/html'],
  [/zeno\.org\/Zeno\/0\/Suche/, 'zeno-search.html', 'text/html'],
  [/bpb\.de\/rss-feed\/230868\.rss/, 'bpb-feed.xml', 'application/rss+xml'],
  [/bpb\.de\/shop\/zeitschriften\/apuz\/900001/, 'bpb-article-1.html', 'text/html'],
  [/bpb\.de\/shop\/zeitschriften\/apuz\/900002/, 'bpb-article-2.html', 'text/html'],
  [/beispielportal\.de\/artikel\/demokratie-1\.html/, 'webpage-1.html', 'text/html'],
  [/beispielportal\.de\/artikel\/demokratie-2\.html/, 'webpage-2.html', 'text/html'],
];
function makeNet({ fail = [], streams = {} } = {}) {
  const calls = [];
  const mem = new Map();
  const route = (url) => {
    calls.push(url);
    for (const re of fail) if (re.test(url)) throw new Error('network down: ' + url);
    for (const [re, fx, ct] of ROUTES) {
      if (!re.test(url)) continue;
      const body = typeof fx === 'function' ? fx(url) : read(fx);
      return { text: typeof body === 'string' ? body : JSON.stringify(body), contentType: ct || 'text/plain' };
    }
    throw new Error('no fixture for ' + url);
  };
  return {
    ua: 'test', calls,
    async json(url) { return JSON.parse(route(url).text); },
    async jsonLenient(url) { return JSON.parse(route(url).text); },
    async text(url) { const r = route(url); return { ok: true, status: 200, url, contentType: r.contentType, text: r.text }; },
    async raw(url) { const r = route(url); return { ok: true, status: 200, url, contentType: r.contentType, buffer: Buffer.from(r.text) }; },
    stream(url, { signal } = {}) {
      calls.push('stream:' + url);
      const s = streams[url] || streams['*'];
      if (!s) throw new Error('no stream fixture for ' + url);
      if (s.throw) throw new Error(s.throw);
      const chunks = s.chunks || [s.body];
      const body = new ReadableStream({ async pull(c) { const ch = chunks.shift(); if (ch == null) { c.close(); return; } if (signal?.aborted) { c.error(new Error('aborted')); return; } await new Promise((r) => setTimeout(r, 2)); c.enqueue(new Uint8Array(Buffer.from(ch))); } });
      return Promise.resolve({ ok: s.status ? s.status < 400 : true, status: s.status || 200, headers: new Headers({ 'content-type': s.contentType || 'application/octet-stream', ...(s.length ? { 'content-length': String(s.length) } : {}) }), body });
    },
    cache: { get: (k) => mem.get(k) || null, set: (k, data) => { const e = { at: Date.now(), data }; mem.set(k, e); return e; } },
  };
}
const deps = (o) => ({ net: makeNet(o) });

(async () => {
  console.log('xml');
  await test('parses attributes, entities, CDATA, self-closing and nested elements', () => {
    const root = X.parseXml('<?xml version="1.0"?><!DOCTYPE x><a x="1" y=\'two &amp; three\'><b/><c>x &lt; y &#228; &#xE9;</c><d><![CDATA[<raw>]]></d><!-- c --><e:f>ns</e:f></a>');
    assert.strictEqual(root.name, 'a'); assert.strictEqual(root.attrs.y, 'two & three');
    assert.strictEqual(X.childText(root, 'c'), 'x < y ä é'); assert.strictEqual(X.childText(root, 'd'), '<raw>');
    assert.strictEqual(X.child(root, 'f').name, 'e:f'); assert.strictEqual(X.children(root).length, 4);
    assert.strictEqual(X.innerXml(X.child(root, 'c')), 'x &lt; y ä é');
  });

  console.log('opds');
  await test('Standard Ebooks feed → publications with acquisition links, cover, subjects', () => {
    const f = parseOpds(read('standardebooks-opds.xml'), 'https://standardebooks.org/feeds/opds/new-releases');
    assert.strictEqual(f.title, 'Standard Ebooks New Releases');
    assert.strictEqual(f.publications.length, 2); assert.strictEqual(f.navigation.length, 1);
    const p = f.publications[0];
    assert.strictEqual(p.title, 'Pride and Prejudice'); assert.strictEqual(p.authors[0].name, 'Jane Austen'); assert.strictEqual(p.language, 'en-GB');
    assert.strictEqual(p.acquisition.length, 4); assert(p.cover.endsWith('cover.jpg')); assert(p.thumbnail.endsWith('thumbnail.jpg'));
    assert.deepStrictEqual(p.subjects.map((s) => s.name), ['Fiction', 'Romance']);
    assert(p.summary.startsWith('Elizabeth Bennet')); assert.strictEqual(p.content.type, 'html');
    assert(f.search.includes('{searchTerms}')); assert.strictEqual(f.next, null);
  });

  console.log('sources');
  await test('sources registry describes every source with browse chips and bilingual descriptions', () => {
    const d = sources.describe();
    assert(d.length >= 11);
    for (const s of d) { assert(s.id && s.name && s.description.de && s.description.en, s.id); assert(Array.isArray(s.browse) && s.browse.length, s.id); for (const b of s.browse) assert(b.id && b.label.de && b.label.en, s.id + '/' + b.id); }
    assert.deepStrictEqual(d.map((s) => s.id).slice(0, 3), ['gutenberg', 'standardebooks', 'gutenberg-de']);
  });
  await test('gutenberg: Gutendex → items (formats, flipped author names, cover, hasMore)', async () => {
    const r = await sources.byId.gutenberg.search('schach', { lang: 'de', page: 1 }, deps());
    assert.strictEqual(r.total, 3); assert.strictEqual(r.hasMore, true); assert.strictEqual(r.items.length, 3);
    const c = r.items[0];
    assert.strictEqual(c.id, 'gutenberg:5614'); assert.strictEqual(c.author, 'José Raúl Capablanca'); assert.strictEqual(c.language, 'en');
    assert.deepStrictEqual(c.formats.map((f) => f.type), ['epub', 'mobi', 'html', 'txt']);
    assert(c.formats[0].url.endsWith('5614.epub3.images')); assert(c.cover.includes('pg5614.cover')); assert(c.canRead); assert.strictEqual(c.license, 'Public Domain');
    assert(c.description.startsWith('"Chess Fundamentals"')); assert.strictEqual(c.downloads, 1412);
    const z = r.items[1]; assert.strictEqual(z.author, 'Stefan Zweig'); assert.strictEqual(z.language, 'de'); assert(z.subjects.includes('DE Prosa'));
    const s = r.items[2]; assert(s.formats.find((f) => f.type === 'epub').url.endsWith('epub3.images'), 'prefers images edition'); assert.strictEqual(s.author, 'Howard Staunton, Anonymous');
    const b = await sources.byId.gutenberg.browse('chess', { lang: null, page: 2 }, deps()); assert.strictEqual(b.page, 2);
  });
  await test('standardebooks: OPDS browse + HTML search with derived epub URLs', async () => {
    const d = deps();
    const b = await sources.byId.standardebooks.browse('new', {}, d);
    assert.strictEqual(b.items.length, 2);
    assert.strictEqual(b.items[0].formats.find((f) => f.type === 'epub').url, 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub?source=download');
    assert.strictEqual(b.items[0].formats.length, 2, 'epub + azw3, no advanced/kepub'); assert(b.items[0].cover.endsWith('thumbnail.jpg'));
    assert.strictEqual(b.items[1].author, 'Homer'); assert.strictEqual(b.items[1].readOnlineUrl, 'https://standardebooks.org/ebooks/homer/the-iliad/william-cowper');
    const s = await sources.byId.standardebooks.search('chess', {}, d);
    assert.strictEqual(s.items.length, 2);
    assert.strictEqual(s.items[0].title, 'Chess Story'); assert.strictEqual(s.items[0].author, 'Stefan Zweig');
    assert.strictEqual(s.items[0].formats[0].url, 'https://standardebooks.org/ebooks/stefan-zweig/chess-story/anthea-bell/downloads/stefan-zweig_chess-story_anthea-bell.epub?source=download');
    assert(s.items[0].cover.startsWith('https://standardebooks.org/images/covers/'));
  });
  await test('wikisource: search skips project pages, enriches thumbnails, WS-Export epub format', async () => {
    const r = await sources.byId.wikisource.search('Faust', { lang: 'de' }, deps());
    assert.strictEqual(r.items.length, 3, 'Wikisource: namespace hit dropped'); assert.strictEqual(r.total, 137); assert(r.hasMore);
    const f = r.items[0];
    assert.strictEqual(f.id, 'wikisource:de:Faust - Der Tragödie erster Teil'); assert(f.cover.includes('Faust_I_Titel')); assert(f.description.startsWith('Faust. Eine Tragödie'));
    assert.strictEqual(f.formats[0].type, 'epub'); assert(f.formats[0].url.startsWith('https://ws-export.wmcloud.org/?format=epub&lang=de&page=Faust_-_Der')); assert.strictEqual(f.formats[0].fallback, 'build');
    assert(f.canRead); assert.strictEqual(f.meta.host, 'de.wikisource.org');
    const b = await sources.byId.wikisource.browse('fairy', { lang: 'de' }, deps());
    assert.strictEqual(b.items.length, 2); assert.strictEqual(b.cont, 'page|4f4e|12345'); assert(b.hasMore);
    const rnd = await sources.byId.wikisource.browse('random', { lang: 'en' }, deps()); assert.strictEqual(rnd.items[0].meta.host, 'en.wikisource.org');
  });
  await test('wikisource: readHtml extracts author, strips Textdaten/scripts, keeps text and images', async () => {
    const item = (await sources.byId.wikisource.search('Sandmann', { lang: 'de' }, deps())).items[2];
    const r = await readable.readItem(item, {}, deps());
    assert.strictEqual(r.author, 'E. T. A. Hoffmann'); assert.strictEqual(r.title, 'Der Sandmann');
    assert(!/Textdaten|<script|Bearbeitungsstand|pagenum|\[12\]/.test(r.html), r.html);
    assert(r.html.includes('Gewiß seid Ihr alle voll Unruhe')); assert(r.html.includes('data-wiki="Der goldne Topf"'));
    assert(r.html.includes('src="https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Sandmann.jpg/220px-Sandmann.jpg"')); assert(!r.html.includes('srcset'));
    assert(r.html.includes('href="https://example.org/hoffmann"')); assert.strictEqual(r.pages, 1); assert.strictEqual(r.source, 'Wikisource');
  });
  await test('wikibooks: chapter hits collapse into the book; readHtml stitches chapters in TOC order', async () => {
    const d = deps();
    const r = await sources.byId.wikibooks.search('Schach', { lang: 'de' }, d);
    assert.deepStrictEqual(r.items.map((i) => i.title), ['Schach', 'Go']);
    assert.strictEqual(r.items[0].formats[0].url, 'build://epub'); assert(r.items[0].meta.multiPage);
    const book = await readable.readItem(r.items[0], { chapters: 'all' }, d);
    assert.strictEqual(book.pages, 5, 'main + Regeln, Eröffnungen, Endspiel (TOC order) + Glossar (prefix search)');
    assert.deepStrictEqual(book.chapters.map((c) => c.title), ['Schach', 'Regeln', 'Eröffnungen', 'Endspiel', 'Glossar']);
    assert(book.html.includes('<section class="cat-chapter" id="ch2"><h2 class="cat-chapter-title" id="ch2-h">Regeln</h2>'));
    assert(book.html.includes('Der König zieht ein Feld')); assert(!book.html.includes('Wikibooks:Regeln'));
  });
  await test('archive: advancedsearch docs → items with lazy ia:// formats; metadata resolves files', async () => {
    const d = deps();
    const r = await sources.byId.archive.search('schach', { lang: 'de' }, d);
    assert.strictEqual(r.total, 312); assert(r.hasMore); assert.strictEqual(r.items.length, 3);
    assert(d.net.calls[0].includes('language%3A%28ger'), 'language filter applied');
    const l = r.items[0];
    assert.strictEqual(l.author, 'Emanuel Lasker', 'author flipped, life dates dropped');
    assert.deepStrictEqual(l.formats.map((f) => f.type), ['epub', 'pdf', 'txt']); assert.strictEqual(l.formats[0].url, 'ia://lehrbuchdesschac00lask#epub');
    assert.strictEqual(l.license, 'Public Domain'); assert(l.cover.includes('services/img/lehrbuchdesschac00lask')); assert.strictEqual(l.year, '1926'); assert.strictEqual(l.language, 'de');
    const c = r.items[1]; assert.strictEqual(c.language, 'en'); assert.deepStrictEqual(c.formats.map((f) => f.type), ['pdf', 'txt']); assert(c.description.includes('Reprint'));
    assert.strictEqual(r.items[2].formats[0].type, 'auto');
    const e = await sources.byId.archive.resolveFormat(l.formats[0], d); assert.strictEqual(e.url, 'https://archive.org/download/lehrbuchdesschac00lask/lehrbuchdesschac00lask.epub'); assert.strictEqual(e.size, 3456789);
    const p = await sources.byId.archive.resolveFormat(l.formats[1], d); assert(p.url.endsWith('/lehrbuchdesschac00lask.pdf'), 'original pdf, not _bw');
    const a = await sources.byId.archive.resolveFormat({ type: 'auto', url: 'ia://lehrbuchdesschac00lask#auto' }, d); assert.strictEqual(a.type, 'epub');
  });
  await test('openlibrary: only docs with an IA scan become items; formats resolve through archive', async () => {
    const r = await sources.byId.openlibrary.search('chess', { lang: 'en' }, deps());
    assert.strictEqual(r.items.length, 1); const i = r.items[0];
    assert.strictEqual(i.id, 'openlibrary:OL66554W'); assert.strictEqual(i.year, '1921'); assert(i.cover.includes('8231856-M.jpg')); assert.strictEqual(i.formats[0].url, 'ia://chessfundamental00capa#auto');
    assert(i.description.startsWith('The first thing'));
    const f = await sources.byId.openlibrary.resolveFormat({ type: 'pdf', url: 'ia://chessfundamental00capa#pdf' }, deps()); assert(f.url.includes('archive.org/download/'));
  });
  await test('oapen: DSpace items → PDF/EPUB bitstreams, editors, cover; DOAB fallback when OAPEN is down', async () => {
    const r = await sources.byId.oapen.search('aufmerksamkeit', { lang: 'de' }, deps());
    assert.strictEqual(r.items.length, 2); const a = r.items[0];
    assert.strictEqual(a.author, 'Georg Franck'); assert.strictEqual(a.year, '2019'); assert.strictEqual(a.language, 'de');
    assert.strictEqual(a.formats[0].url, 'https://library.oapen.org/rest/bitstreams/b1/retrieve'); assert.strictEqual(a.formats[0].size, 2451234);
    assert.strictEqual(a.cover, 'https://library.oapen.org/rest/bitstreams/b2/retrieve'); assert(a.subjects.includes('Economics')); assert.strictEqual(a.license, 'Open Access');
    assert.strictEqual(a.readOnlineUrl, 'https://library.oapen.org/handle/20.500.12657/41234'); assert.strictEqual(a.meta.publisher, 'transcript Verlag');
    const b = r.items[1]; assert.strictEqual(b.author, 'Gregor Fitzi (Hg.), Jürgen Mackert (Hg.)'); assert.deepStrictEqual(b.formats.map((f) => f.type), ['epub', 'pdf']);
    const fb = await sources.byId.oapen.search('theorie', { lang: 'de' }, deps({ fail: [/oapen\.org/] }));
    assert(fb.note && /DOAB/.test(fb.note)); assert.strictEqual(fb.items.length, 1); assert.strictEqual(fb.items[0].formats[0].url, 'https://www.example-verlag.de/download/politische-theorie.pdf'); assert.strictEqual(fb.items[0].meta.origin, 'doab');
  });
  await test('librivox: audiobooks → audio-rss format, IA cover, duration; title/author results merged', async () => {
    const r = await sources.byId.librivox.search('Faust', {}, deps());
    assert.strictEqual(r.items.length, 2, 'same fixture for both calls → deduped'); const f = r.items[0];
    assert.strictEqual((await sources.byId.librivox.search('Faust', { lang: 'de' }, deps())).items.length, 1, 'client-side language filter');
    assert.strictEqual(f.kind, 'audiobook'); assert.strictEqual(f.formats[0].type, 'audio-rss'); assert.strictEqual(f.formats[0].url, 'https://librivox.org/rss/1234');
    assert.strictEqual(f.author, 'Johann Wolfgang von Goethe'); assert.strictEqual(f.language, 'de'); assert.strictEqual(f.cover, 'https://archive.org/services/img/faust_1_0810_librivox');
    assert.strictEqual(f.meta.hours, 4.6); assert.strictEqual(f.meta.sections, 28); assert(!/<p>/.test(f.description)); assert.strictEqual(f.year, '1808');
    const b = await sources.byId.librivox.browse('german', {}, deps()); assert.strictEqual(b.items.length, 1, 'German only');
  });
  await test('arxiv: Atom → papers with https pdf links, ids without version, totals', async () => {
    const r = await sources.byId.arxiv.search('chess', {}, deps());
    assert.strictEqual(r.total, 1532); assert(r.hasMore); assert.strictEqual(r.items.length, 2);
    const p = r.items[0]; assert.strictEqual(p.id, 'arxiv:1712.01815'); assert.strictEqual(p.formats[0].url, 'https://arxiv.org/pdf/1712.01815'); assert.strictEqual(p.year, '2017');
    assert.strictEqual(p.author, 'David Silver, Thomas Hubert, Julian Schrittwieser'); assert(p.title.startsWith('Mastering Chess and Shogi by Self-Play with a General Reinforcement Learning'));
    assert.deepStrictEqual(p.subjects, ['cs.AI', 'cs.LG']); assert.strictEqual(r.items[1].meta.doi, '10.1000/xyz123');
    assert(p.canRead && p.meta.readAlts[0].includes('/html/1712.01815'), 'arXiv papers are readable in-app');
  });
  await test('every source offers a way to read: canRead or at least one downloadable format', async () => {
    const d = deps();
    const checks = [
      ['gutenberg', () => sources.byId.gutenberg.search('schach', {}, d)],
      ['standardebooks', () => sources.byId.standardebooks.browse('new', {}, d)],
      ['wikisource', () => sources.byId.wikisource.search('Faust', { lang: 'de' }, d)],
      ['wikibooks', () => sources.byId.wikibooks.search('Schach', { lang: 'de' }, d)],
      ['archive', () => sources.byId.archive.search('schach', {}, d)],
      ['openlibrary', () => sources.byId.openlibrary.search('chess', {}, d)],
      ['oapen', () => sources.byId.oapen.search('aufmerksamkeit', {}, d)],
      ['arxiv', () => sources.byId.arxiv.search('chess', {}, d)],
      ['gutenberg-de', () => sources.byId['gutenberg-de'].browse('classics', {}, d)],
      ['zeno', () => sources.byId.zeno.browse('literatur', {}, d)],
      ['web', () => sources.byId.web.browse('portals', {}, d)],
    ];
    for (const [id, run] of checks) {
      const r = await run();
      assert(r.items.length, id + ': no items');
      for (const it of r.items) assert(it.canRead || it.formats.some((f) => f.type !== 'audio-rss'), `${id}: "${it.title}" can neither be read nor downloaded`);
    }
    // Standard Ebooks read the single-page edition, Internet Archive / Open Library the OCR full text
    const se = (await sources.byId.standardebooks.browse('new', {}, d)).items[0];
    assert(se.canRead && se.meta.url.endsWith('/text/single-page'));
    const ia = (await sources.byId.archive.search('schach', {}, d)).items[0];
    assert(ia.canRead && ia.meta.identifier);
  });
  await test('archive/openlibrary: the OCR full text becomes readable chapters', async () => {
    const d = deps();
    const ia = (await sources.byId.archive.search('schach', {}, d)).items[0];
    const book = await readable.readItem(ia, {}, d);
    assert(d.net.calls.some((u) => /_djvu\.txt$/.test(u)));
    assert.strictEqual(book.source, 'Internet Archive'); assert(book.pages >= 1);
    assert(book.html.includes('Das Schachspiel ist ein Kampfspiel'));
    assert(!/<script|<p><\/p>/.test(book.html));
  });
  await test('openlibrary: subjects are ranked (broad first) and catalogue noise is dropped', () => {
    const ranked = sources.byId.openlibrary.rankSubjects(['Accessible book', 'Protected DAISY', 'Chess -- Middle games', 'Chess', 'History', 'nyt:paperback_nonfiction=2011-01-01', 'Chess for children, juvenile literature', 'In library']);
    assert.deepStrictEqual(ranked.slice(0, 2), ['Chess', 'History']);
    assert(!ranked.some((s) => /Accessible|DAISY|In library|nyt:| -- /.test(s)), ranked.join(' | '));
  });
  await test('web: a portal whose article list only exists as a feed is read through that feed', async () => {
    const d = deps();
    const apuz = (await sources.byId.web.browse('portals', {}, d)).items.find((i) => /APuZ/.test(i.title));
    assert(apuz && apuz.meta.feed, 'the APuZ portal carries its RSS feed');
    const book = await readable.readItem(apuz, {}, d);
    assert.strictEqual(book.pages, 2);
    assert.deepStrictEqual(book.chapters.map((c) => c.title), ['Biodiversität', 'Konservatismus']);
    assert(book.html.includes('Die biologische Vielfalt schwindet')); assert(book.html.includes('Was heißt es heute, konservativ zu sein'));
    assert(!/Impressum|bpb\.de<\/a>/.test(book.html));
  });
  await test('gutenberg-de: new /authors/…/books/… layout – letter index, author route, cached pages', async () => {
    const d = deps();
    const gd = sources.byId['gutenberg-de'];
    const r = await gd.search('Die Verwandlung', {}, d);
    const k = r.items[0];
    assert.strictEqual(k.title, 'Die Verwandlung'); assert.strictEqual(k.author, 'Franz Kafka');
    assert.strictEqual(k.readOnlineUrl, 'https://projekt-gutenberg.org/authors/franz-kafka/books/die-verwandlung/');
    assert.strictEqual(k.id, 'gutenberg-de:authors/franz-kafka/books/die-verwandlung'); assert(k.canRead);
    // author route: "kafka" is found through /autoren/?gl_letter=K → /authors/franz-kafka/
    const byAuthor = await gd.search('kafka', {}, d);
    assert.strictEqual(byAuthor.items.length, 3, 'all three Kafka works from the author page');
    assert(d.net.calls.some((u) => /autoren\/\?gl_letter=K/.test(u)));
    const before = d.net.calls.length;
    await gd.search('kafka', {}, d);
    assert(!d.net.calls.slice(before).some((u) => /authors\/franz-kafka/.test(u)), 'directory pages come from the cache');
    // the title index strips the repeated author prefix
    const heine = (await gd.search('Deutschland', {}, d)).items[0];
    assert.strictEqual(heine.title, 'Deutschland. Ein Wintermärchen');
    const cl = await gd.browse('classics', {}, d); assert(cl.items.length >= 15);
    assert(cl.items[0].readOnlineUrl.startsWith('https://projekt-gutenberg.org/authors/'));
    const top = await gd.browse('meistgelesen', {}, d);
    assert.strictEqual(top.items[0].title, 'Faust: Eine Tragödie', 'the "#1" rank prefix is removed');
  });
  await test('gutenberg-de: reading walks /chapter/N and does not inherit the wrong og:title', async () => {
    const d = deps();
    const k = (await sources.byId['gutenberg-de'].search('Die Verwandlung', {}, d)).items[0];
    const book = await readable.readItem(k, { chapters: 'all' }, d);
    assert.strictEqual(book.title, 'Die Verwandlung', 'h1/<title>, not the site-wide og:title');
    assert(!/EPUBs auf einem Lesegerät/.test(book.title + book.chapters.map((c) => c.title).join()), 'og:title never becomes a chapter title');
    assert.strictEqual(book.pages, 3);
    assert.deepStrictEqual(book.chapters.map((c) => c.title), ['Die Verwandlung', 'Kapitel 1', 'Kapitel 2']);
    assert(book.html.includes('Als Gregor Samsa eines Morgens')); assert(book.html.includes('Erst in der Abenddämmerung'));
    assert(!/Impressum/.test(book.html), 'footer navigation dropped');
  });
  await test('zeno: plain http (no TLS listener) and search results with authors from the path', async () => {
    const r = await sources.byId.zeno.search('Sandmann', {}, deps());
    assert.strictEqual(r.items.length, 2); assert.strictEqual(r.items[0].author, 'E. T. A. Hoffmann');
    assert(r.items[0].readOnlineUrl.startsWith('http://www.zeno.org/Literatur/M/Hoffmann'), r.items[0].readOnlineUrl);
    assert(!/^https:/.test(r.items[0].meta.url), 'zeno.org must not be requested over https');
    assert(r.items[0].description.startsWith('Nathanael'));
    assert.strictEqual(r.items[1].author, 'Hans Christian Andersen');
    const portals = await sources.byId.zeno.browse('literatur', {}, deps());
    assert(portals.items[0].meta.index, 'portal pages are read as a directory');
  });
  await test('web: URL → item; readUrl follows rel=next, cleans scripts/nav, absolutizes images', async () => {
    const d = deps();
    const r = await sources.byId.web.search('beispielportal.de/artikel/demokratie-1.html', {}, d);
    assert.strictEqual(r.items.length, 1); assert.strictEqual(r.items[0].meta.url, 'https://beispielportal.de/artikel/demokratie-1.html');
    const bad = await sources.byId.web.search('kein link', {}, d); assert.strictEqual(bad.items.length, 0); assert(bad.note);
    const book = await readable.readWeb('https://beispielportal.de/artikel/demokratie-1.html', {}, d);
    assert.strictEqual(book.pages, 2); assert.strictEqual(book.title, 'Demokratie unter Druck'); assert.strictEqual(book.author, 'Erika Beispiel');
    assert.deepStrictEqual(book.chapters.map((c) => c.title), ['Teil 1', 'Teil 2']);
    assert(book.html.includes('src="https://beispielportal.de/img/grafik.png"')); assert(!/track\(\)|Impressum/.test(book.html)); assert(book.html.includes('deliberative Verfahren'));
    assert.strictEqual(book.image, 'https://beispielportal.de/img/teaser.jpg'); assert.strictEqual(book.source, 'beispielportal.de');
    const portals = await sources.byId.web.browse('portals', {}, d); assert(portals.items.length >= 10 && portals.items.every((p) => p.canRead));
  });

  console.log('epub');
  await test('buildEpub produces a valid zip with stored mimetype first and well-formed XHTML chapters', () => {
    const buf = epub.buildEpub({ title: 'Test & Buch', author: 'Anna <Muster>', language: 'de', source: 'Wikisource', sourceUrl: 'https://de.wikisource.org/wiki/Test', chapters: [{ title: 'Eins', html: '<p>Hallo <b>Welt</b><br>Zeile<img src="https://x.org/a.jpg" loading="lazy"></p><p>&nbsp;Ende & Aus</p>' }, { title: 'Zwei', html: '<h3>Kapitel</h3><ul><li>a<li>b</ul>' }] });
    assert(epub.looksLikeEpub(buf));
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50); assert.strictEqual(buf.readUInt16LE(8), 0, 'mimetype stored');
    assert.strictEqual(buf.subarray(30, 38).toString(), 'mimetype'); assert.strictEqual(buf.subarray(38, 58).toString(), 'application/epub+zip');
    const entries = readZip(buf);
    assert.deepStrictEqual(Object.keys(entries).slice(0, 3), ['mimetype', 'META-INF/container.xml', 'OEBPS/style.css']);
    assert(entries['OEBPS/content.opf'].includes('<dc:title>Test &amp; Buch</dc:title>')); assert(entries['OEBPS/content.opf'].includes('<dc:creator id="creator">Anna &lt;Muster&gt;</dc:creator>'));
    assert(entries['OEBPS/nav.xhtml'].includes('<li><a href="ch001.xhtml">Eins</a></li>'));
    const { JSDOM } = require('jsdom');
    for (const name of ['OEBPS/ch001.xhtml', 'OEBPS/ch002.xhtml', 'OEBPS/nav.xhtml', 'OEBPS/content.opf', 'META-INF/container.xml']) {
      const dom = new JSDOM(entries[name], { contentType: 'application/xml' });
      assert(!dom.window.document.querySelector('parsererror'), name + ' not well-formed');
    }
    assert(entries['OEBPS/ch001.xhtml'].includes('<br />') || entries['OEBPS/ch001.xhtml'].includes('<br/>'), 'void elements closed');
    assert(entries['OEBPS/ch001.xhtml'].includes('<h1>Test &amp; Buch</h1>'));
  });

  await test('buildEpub embeds resources and keeps a heading for a single forced chapter', () => {
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
    const buf = epub.buildEpub({ title: 'Sammelband', language: 'de', chapters: [{ title: 'Erster Artikel', html: '<p>Text<img src="img/a.png" alt="A"></p>' }], resources: [{ name: 'img/a.png', data: png, mime: 'image/png' }, { name: '../böse.png', data: png, mime: 'image/png' }], forceChapterTitles: true });
    const files = epub.unzip(buf);
    assert.deepStrictEqual(files.find((f) => f.name === 'OEBPS/img/a.png').data, png, 'image stored unchanged');
    assert(!files.some((f) => f.name.includes('..') || f.name.includes('böse')), 'unsafe resource names are skipped');
    const opf = files.find((f) => f.name === 'OEBPS/content.opf').data.toString();
    assert(opf.includes('href="img/a.png" media-type="image/png"'));
    const ch = files.find((f) => f.name === 'OEBPS/ch001.xhtml').data.toString();
    assert(ch.includes('<h2 class="cat-chapter-title">Erster Artikel</h2>'));
    assert(files.find((f) => f.name === 'OEBPS/nav.xhtml').data.toString().includes('>Erster Artikel</a>'));
    assert.deepStrictEqual(epub.readEpubSummary(buf), { title: 'Sammelband', language: 'de', chapters: 1 });
  });

  await test('appendChapters adds chapters to an EPUB 3 (manifest, spine, nav) and leaves the rest untouched', () => {
    const base = epub.buildEpub({ title: 'Sammelband', language: 'de', chapters: [{ title: 'Eins', html: '<p>eins</p>' }], forceChapterTitles: true });
    const jpg = Buffer.from('ffd8ffe000104a464946', 'hex');
    const once = epub.appendChapters(base, [{ title: 'Zwei & mehr', html: '<p>zwei<br>Zeile<img src="img/b.jpg"></p><script>x()</script>' }], { resources: [{ name: 'img/b.jpg', data: jpg, mime: 'image/jpeg' }] });
    const twice = epub.appendChapters(once, [{ title: 'Drei', html: '<p>drei</p>' }]);
    assert(epub.looksLikeEpub(twice));
    assert.strictEqual(twice.subarray(30, 38).toString(), 'mimetype', 'mimetype stays the first, stored entry');
    assert.strictEqual(twice.readUInt16LE(8), 0);
    const files = epub.unzip(twice);
    const get = (n) => files.find((f) => f.name === n)?.data.toString();
    const opf = get('OEBPS/content.opf');
    assert.deepStrictEqual([...opf.matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]), ['ch001', 'lsb-kapitel', 'lsb-kapitel-2']);
    assert(opf.includes('href="lesesaal-kapitel.xhtml"') && opf.includes('href="lesesaal-kapitel-2.xhtml"'));
    assert.strictEqual((opf.match(/lesesaal-sammelband\.css/g) || []).length, 1, 'one stylesheet for all appended chapters');
    assert(opf.includes('href="img/b.jpg" media-type="image/jpeg"'));
    const nav = get('OEBPS/nav.xhtml');
    assert(/<li><a href="ch001.xhtml">Eins<\/a><\/li><li><a href="lesesaal-kapitel.xhtml">Zwei &amp; mehr<\/a><\/li><li><a href="lesesaal-kapitel-2.xhtml">Drei<\/a><\/li><\/ol>/.test(nav), 'nav lists all chapters in order');
    const ch = get('OEBPS/lesesaal-kapitel.xhtml');
    assert(!ch.includes('<script'), 'scripts are removed');
    assert.deepStrictEqual(files.find((f) => f.name === 'OEBPS/img/b.jpg').data, jpg);
    const { JSDOM } = require('jsdom');
    for (const name of ['OEBPS/lesesaal-kapitel.xhtml', 'OEBPS/lesesaal-kapitel-2.xhtml', 'OEBPS/nav.xhtml', 'OEBPS/content.opf']) {
      const dom = new JSDOM(get(name), { contentType: 'application/xml' });
      assert(!dom.window.document.querySelector('parsererror'), name + ' not well-formed');
    }
    assert.strictEqual(get('OEBPS/ch001.xhtml'), epub.unzip(base).find((f) => f.name === 'OEBPS/ch001.xhtml').data.toString(), 'existing chapter unchanged');
    assert.deepStrictEqual(epub.readEpubSummary(twice), { title: 'Sammelband', language: 'de', chapters: 3 });
  });

  await test('appendChapters extends an EPUB 2 with toc.ncx in a sub folder (relative links, playOrder)', () => {
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Alt</dc:title><dc:language>en</dc:language><dc:identifier id="id">x</dc:identifier></metadata>
<manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="c1"/></spine></package>`;
    const ncx = '<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="n1" playOrder="1"><navLabel><text>One</text></navLabel><content src="Text/c1.xhtml"/></navPoint></navMap></ncx>';
    const c1 = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body><p>one</p></body></html>';
    const old = epub.zip([
      { name: 'mimetype', data: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
      { name: 'OPS/content.opf', data: opf }, { name: 'OPS/toc.ncx', data: ncx }, { name: 'OPS/Text/c1.xhtml', data: c1 },
    ]);
    const out = epub.appendChapters(old, [{ title: 'Two', html: '<p>two</p>' }]);
    const files = epub.unzip(out);
    const get = (n) => files.find((f) => f.name === n)?.data.toString();
    assert(get('OPS/lesesaal-kapitel.xhtml').includes('xml:lang="en"'), 'language of the book is kept');
    assert(get('OPS/content.opf').includes('<itemref idref="c1"/><itemref idref="lsb-kapitel"/>'));
    assert(get('OPS/toc.ncx').includes('<navPoint id="lsb-navpoint-2" playOrder="2"><navLabel><text>Two</text></navLabel><content src="lesesaal-kapitel.xhtml"/></navPoint></navMap>'));
    assert.strictEqual(get('OPS/Text/c1.xhtml'), c1);
    assert.throws(() => epub.appendChapters(Buffer.from('kein zip, nur Text'), [{ title: 'x', html: 'y' }]), /ZIP/);
  });

  console.log('download');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-cat-'));
  const folders = [{ path: path.join(tmp, 'structured'), mode: 'structured' }, { path: path.join(tmp, 'auto'), mode: 'auto' }];
  const settings = { get: (k) => (k === 'folders' ? folders : { folders }) };
  const makeLib = () => ({ rescans: 0, async rescanQuiet() { this.rescans++; } });
  const events = [];
  const broadcast = (ch, p) => events.push([ch, p]);
  const PK = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(26), Buffer.from('mimetypeapplication/epub+zip'), Buffer.alloc(4000, 1)]);
  await test('fileNameFor sanitizes "<Title> - <Author>.<ext>"', () => {
    assert.strictEqual(download.fileNameFor({ title: 'Faust: Der Tragödie / erster Teil?', author: 'Goethe, Johann W.' }, 'epub'), 'Faust Der Tragödie erster Teil - Goethe, Johann W.epub');
    const long = download.fileNameFor({ title: 'x'.repeat(300), author: 'y'.repeat(100) }, 'pdf'); assert(long.length <= 155, long.length);
    assert.strictEqual(download.fileNameFor({ title: '  ..Titel..  ' }, 'txt'), 'Titel.txt');
  });
  await test('download streams an EPUB into <auto folder>/Online-Katalog/<Source>, emits progress, rescans', async () => {
    const lib = makeLib(); events.length = 0;
    const url = 'https://www.gutenberg.org/ebooks/5614.epub3.images';
    const net = makeNet({ streams: { [url]: { chunks: [PK.subarray(0, 1000), PK.subarray(1000)], contentType: 'application/epub+zip', length: PK.length } } });
    const cat = createCatalog({ net, settings, library: lib, broadcast });
    const item = (await cat.search('gutenberg', 'schach', { lang: 'en' })).items[0];
    const r = await cat.download(item, 0);
    const expected = path.join(tmp, 'auto', 'Online-Katalog', 'Project Gutenberg', 'Chess Fundamentals - José Raúl Capablanca.epub');
    assert.strictEqual(r.path, expected); assert(fs.existsSync(expected)); assert.strictEqual(fs.statSync(expected).size, PK.length); assert(!fs.existsSync(expected + '.part'));
    assert.strictEqual(lib.rescans, 1);
    const prog = events.filter((e) => e[0] === 'catalog:progress').map((e) => e[1]);
    assert(prog.length >= 2); assert.strictEqual(prog[0].id, item.id); assert(prog.at(-1).done && prog.at(-1).path === expected && prog.at(-1).received === PK.length);
    // duplicate → existing file returned, nothing re-downloaded
    const r2 = await cat.download(item, 0); assert(r2.existed); assert.strictEqual(net.calls.filter((c) => c.startsWith('stream:')).length, 1);
  });
  await test('download rejects HTML error pages / wrong magic bytes and leaves no file behind', async () => {
    events.length = 0;
    const url = 'https://www.gutenberg.org/ebooks/33870.epub.noimages';
    const net = makeNet({ streams: { [url]: { body: '<!doctype html><html>Blocked</html>', contentType: 'text/html' } } });
    const cat = createCatalog({ net, settings, library: makeLib(), broadcast });
    const item = (await cat.search('gutenberg', 'schach', {})).items[1];
    await assert.rejects(() => cat.download(item, 0), /HTML-Seite/);
    const net2 = makeNet({ streams: { [url]: { body: '<html>not a zip</html>', contentType: 'application/octet-stream' } } });
    const cat2 = createCatalog({ net: net2, settings, library: makeLib(), broadcast });
    await assert.rejects(() => cat2.download(item, 0), /kein EPUB/);
    const dir = path.join(tmp, 'auto', 'Online-Katalog', 'Project Gutenberg');
    assert(!fs.readdirSync(dir).some((f) => /Schachnovelle/.test(f)), 'no partial file');
    assert(events.some((e) => e[1].error && /kein EPUB/.test(e[1].error)));
  });
  await test('download follows a meta-refresh download page (Standard Ebooks) to the real file', async () => {
    const url = 'https://www.gutenberg.org/ebooks/33870.epub.noimages';
    const page = '<?xml version="1.0"?><!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=/files/real.epub?source=download" /></head><body>Danke</body></html>';
    const net = makeNet({ streams: { [url]: { body: page, contentType: 'application/xhtml+xml; charset=utf-8' }, 'https://www.gutenberg.org/files/real.epub?source=download': { body: PK, contentType: 'application/epub+zip' } } });
    const cat = createCatalog({ net, settings, library: makeLib(), broadcast });
    const item = (await cat.search('gutenberg', 'schach', {})).items[1];
    const r = await cat.download(item, 0);
    assert(fs.existsSync(r.path) && fs.readFileSync(r.path).subarray(0, 2).toString('latin1') === 'PK', 'epub written');
    assert(net.calls.includes('stream:https://www.gutenberg.org/files/real.epub?source=download'), 'refresh target fetched');
    fs.unlinkSync(r.path);
  });
  await test('download resolves ia:// formats through the archive metadata and returns the library id', async () => {
    const url = 'https://archive.org/download/lehrbuchdesschac00lask/lehrbuchdesschac00lask.epub';
    const net = makeNet({ streams: { [url]: { body: PK, contentType: 'application/epub+zip' } } });
    const cat = createCatalog({ net, settings, library: makeLib(), broadcast });
    const item = (await cat.search('archive', 'schach', { lang: 'de' })).items[0];
    const r = await cat.download(item, 0);
    assert.strictEqual(path.basename(r.path), 'Lehrbuch des Schachspiels - Emanuel Lasker.epub'); assert(net.calls.includes('stream:' + url));
    // the id the library scanner will use – it lets the panel open the fresh file in the reader
    assert.strictEqual(r.bookId, crypto.createHash('sha1').update(path.normalize(r.path).toLowerCase()).digest('hex').slice(0, 16));
    assert(events.some((e) => e[0] === 'catalog:progress' && e[1].bookId === r.bookId));
  });
  await test('download builds an EPUB for wiki / web items (build://epub) and falls back when WS Export fails', async () => {
    const net = makeNet({ streams: { '*': { body: '<html>ws-export error</html>', contentType: 'text/html' } } });
    const cat = createCatalog({ net, settings, library: makeLib(), broadcast });
    const wb = (await cat.search('wikibooks', 'Schach', { lang: 'de' })).items[0];
    const r = await cat.download(wb, 0);
    assert.strictEqual(path.basename(r.path), 'Schach - Wikibooks-Autoren.epub'); assert(r.built);
    const buf = fs.readFileSync(r.path); assert(epub.looksLikeEpub(buf));
    const entries = readZip(buf); assert(entries['OEBPS/ch002.xhtml'].includes('Regeln')); assert(entries['OEBPS/content.opf'].includes('<dc:publisher>Wikibooks</dc:publisher>'));
    // Wikisource: WS Export answers with HTML → falls back to the in-app builder
    const ws = (await cat.search('wikisource', 'Sandmann', { lang: 'de' })).items[2];
    const r2 = await cat.toEpub(ws);
    assert.strictEqual(path.basename(r2.path), 'Der Sandmann - E. T. A. Hoffmann.epub', 'author taken from the page'); assert(r2.built);
    assert(readZip(fs.readFileSync(r2.path))['OEBPS/ch001.xhtml'].includes('Gewiß seid Ihr alle voll Unruhe'));
    // web page
    const web = (await cat.search('web', 'https://beispielportal.de/artikel/demokratie-1.html', {})).items[0];
    const r3 = await cat.toEpub(web); assert.strictEqual(path.basename(r3.path), 'Demokratie unter Druck - Erika Beispiel.epub');
    assert(fs.existsSync(path.join(tmp, 'auto', 'Online-Katalog', 'Webseite als Buch')));
  });
  await test('download without a library folder fails with a clear message; audiobooks are refused', async () => {
    const cat = createCatalog({ net: makeNet(), settings: { get: () => [] }, library: makeLib(), broadcast });
    const item = (await cat.search('gutenberg', 'schach', {})).items[0];
    await assert.rejects(() => cat.download(item, 0), /Bücherordner/);
    const lv = (await cat.search('librivox', 'Faust', {})).items[0];
    await assert.rejects(() => cat.download(lv, 0), /Podcast/);
  });

  console.log('ipc');
  await test('register() wires all catalog:* handlers on a fake ipcMain; search results are memoised', async () => {
    const handlers = {};
    const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
    const app = { getPath: () => path.join(tmp, 'userData') };
    const cat = register({ ipcMain, app, settings, library: makeLib(), broadcast });
    assert.deepStrictEqual(Object.keys(handlers).sort(), ['catalog:browse', 'catalog:cancel', 'catalog:download', 'catalog:readHref', 'catalog:readHtml', 'catalog:readUrl', 'catalog:search', 'catalog:sources', 'catalog:toEpub']);
    const srcs = await handlers['catalog:sources']({}); assert(srcs.find((s) => s.id === 'librivox').kind === 'audiobooks');
    await assert.rejects(() => handlers['catalog:search']({}, 'nope', 'x', {}), /Unbekannte Quelle/);
    const empty = await handlers['catalog:search']({}, 'gutenberg', '   ', {}); assert.strictEqual(empty.items.length, 0);
    assert.strictEqual(typeof cat.readUrl, 'function');
    // memo: two identical calls on the createCatalog instance hit the network once
    const net = makeNet(); const c2 = createCatalog({ net, settings, library: makeLib(), broadcast });
    await c2.search('arxiv', 'chess', {}); await c2.search('arxiv', 'chess', {}); assert.strictEqual(net.calls.length, 1);
    assert.strictEqual(handlers['catalog:cancel']({}, 'nothing'), false);
    // 'catalog:readHref' is an alias of 'catalog:readHtml' (older panel builds used that name):
    // both reject identically for an item nothing can be read from – no network involved
    const bad = { id: 'x:1', source: 'x', formats: [], meta: {} };
    const m1 = await handlers['catalog:readHtml']({}, bad, {}).then(() => null, (e) => e.message);
    const m2 = await handlers['catalog:readHref']({}, bad, {}).then(() => null, (e) => e.message);
    assert.strictEqual(m1, m2); assert(/lesen/i.test(m1), m1);
  });
  await test('raw Chromium network errors become German sentences naming the host', async () => {
    const item = { id: 'zeno:x', source: 'zeno', title: 'Test', formats: [], readOnlineUrl: 'https://www.zeno.org/Literatur', meta: { web: true, url: 'https://www.zeno.org/Literatur' } };
    const net = { ...makeNet(), text: async () => { throw new Error('net::ERR_CONNECTION_TIMED_OUT'); } };
    const cat = createCatalog({ net, settings, library: makeLib(), broadcast });
    await assert.rejects(() => cat.readHtml(item, {}), (e) => {
      assert(/zeno\.org/.test(e.message), e.message);
      assert(/Zeitüberschreitung/.test(e.message), e.message);
      assert(!/ERR_|net::/.test(e.message), e.message);
      return true;
    });
    const net2 = { ...makeNet(), json: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }, text: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } };
    const cat2 = createCatalog({ net: net2, settings, library: makeLib(), broadcast });
    await assert.rejects(() => cat2.search('arxiv', 'chess', {}), (e) => /nicht erreichbar/.test(e.message) && !/ERR_/.test(e.message));
  });

  console.log('net');
  await test('net: memo keys include xml/Accept, and https falls back to http once per host', async () => {
    const { createNet } = require('./net');
    const calls = [];
    const io = {
      async fetchText(url, opts) {
        calls.push(url);
        if (/^https:\/\/www\.zeno\.org/.test(url)) throw new Error('net::ERR_CONNECTION_TIMED_OUT');
        return { ok: true, status: 200, url, contentType: opts.xml ? 'application/xml' : 'text/html', text: opts.xml ? '<xml/>' : (opts.headers && opts.headers.Accept) || 'html' };
      },
      async fetchJson(url) { calls.push('j:' + url); return { url }; },
      async fetchRaw(url) { calls.push('r:' + url); return { ok: true, status: 200, url, buffer: Buffer.alloc(0) }; },
      async fetchStream(url) { calls.push('s:' + url); return { ok: true, status: 200, url }; },
    };
    const net = createNet({ io });
    // the xml flag changes the decoding, so it must not share a cache entry with the plain call
    const a = await net.text('https://example.org/x');
    const b = await net.text('https://example.org/x', { xml: true });
    assert.notStrictEqual(a.text, b.text); assert.strictEqual(calls.length, 2);
    await net.text('https://example.org/x');
    assert.strictEqual(calls.length, 2, 'second identical call is memoised');
    const c = await net.text('https://example.org/x', { headers: { Accept: 'application/json' } });
    assert.strictEqual(c.text, 'application/json', 'the Accept header is part of the key');
    // zeno.org: https times out → one retry over http, remembered for the next request
    calls.length = 0;
    const z = await net.text('https://www.zeno.org/Literatur');
    assert.strictEqual(z.url, 'http://www.zeno.org/Literatur');
    assert.deepStrictEqual(calls, ['https://www.zeno.org/Literatur', 'http://www.zeno.org/Literatur']);
    calls.length = 0;
    await net.text('https://www.zeno.org/Philosophie');
    assert.deepStrictEqual(calls, ['http://www.zeno.org/Philosophie'], 'the host is remembered as http-only');
    assert(net.isHttpOnly('https://www.zeno.org/x'));
  });
  await test('net: only web addresses reach the network (a file: address from a page is refused before any fetch)', async () => {
    const { createNet } = require('./net');
    const calls = [];
    const io = {
      async fetchText(url) { calls.push(url); return { ok: true, status: 200, url, text: 'secret' }; },
      async fetchJson(url) { calls.push(url); return {}; },
      async fetchRaw(url) { calls.push(url); return { ok: true, status: 200, url, buffer: Buffer.alloc(0) }; },
      async fetchStream(url) { calls.push(url); return { ok: true, status: 200, url }; },
    };
    const net = createNet({ io });
    for (const u of ['file:///C:/Users/x/library.json', 'app://lesesaal/index.html', 'lfile://local/QQ/x', 'data:text/html,hi', 'example.org/x']) {
      await assert.rejects(() => net.text(u), /not a web address/, 'text ' + u);
      await assert.rejects(() => net.json(u), /not a web address/, 'json ' + u);
      await assert.rejects(() => net.raw(u), /not a web address/, 'raw ' + u);
      await assert.rejects(() => net.stream(u), /not a web address/, 'stream ' + u);
    }
    assert.deepStrictEqual(calls, [], 'the network was asked');
    assert.strictEqual((await net.text('http://example.org/x')).ok, true);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

/** Minimal zip reader for the tests (store + deflate). */
function readZip(buf) {
  const out = {};
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8), csize = buf.readUInt32LE(off + 18), nlen = buf.readUInt16LE(off + 26), xlen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nlen).toString('utf8');
    const data = buf.subarray(off + 30 + nlen + xlen, off + 30 + nlen + xlen + csize);
    out[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    off += 30 + nlen + xlen + csize;
  }
  return out;
}
