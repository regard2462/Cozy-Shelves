// Fixture tests for the feeds/podcasts/wiki/dict parsers.  Run:  node electron/feeds/test-feeds.js
// Plain Node – no Electron and no network required.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const C = require('./common');
const feeds = require('./feeds');
const podcasts = require('./podcasts');
const wiki = require('./wiki');
const dict = require('./dict');
const { FEEDS, CATEGORIES, LEGACY_CATEGORY_MAP, migrateCategoryId } = require('./feedlist');

const FX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f));
const json = (f) => JSON.parse(read(f).toString('utf8'));
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

(async () => {
  console.log('feedlist');
  await test('curated list is consistent', () => {
    const ids = new Set();
    for (const f of FEEDS) {
      assert(!ids.has(f.id), 'duplicate id ' + f.id); ids.add(f.id);
      assert(/^https?:\/\//.test(f.url), 'bad url ' + f.id);
      assert(CATEGORIES.some((c) => c.id === f.category), 'unknown category ' + f.category);
      assert(['de', 'en'].includes(f.lang), 'bad lang ' + f.id);
      assert([true, false, 'readability'].includes(f.fullText), 'bad fullText ' + f.id);
    }
    assert(FEEDS.length >= 120 && FEEDS.length <= 220, 'feed count ' + FEEDS.length);
    const perCat = {}; for (const f of FEEDS) perCat[f.category] = (perCat[f.category] || 0) + 1;
    console.log('       ' + FEEDS.length + ' feeds: ' + Object.entries(perCat).map(([k, v]) => k + '=' + v).join(', '));
    console.log('       ' + FEEDS.filter((f) => f.lang === 'de').length + ' deutsch, ' + FEEDS.filter((f) => f.lang === 'en').length + ' english');
  });

  // 0.7: the newspaper shows the papers of the interface language, so every tag must be right. build/feeds-lang-audit.js
  // fetched every feed once and recognised the language of its titles and summaries (feed-languages.json).
  await test('every paper has the language of its texts (recorded audit)', () => {
    const audit = json('feed-languages.json');
    const wrong = [], missing = [];
    for (const f of FEEDS) {
      const a = audit.feeds[f.id];
      if (!a) { missing.push(f.id); continue; }
      if (a.detected && a.detected !== f.lang) wrong.push(`${f.id}: tag ${f.lang}, texts ${a.detected}`);
      // what a feed declares counts when it is a language code at all (SRF writes "ge")
      if (['de', 'en', 'fr', 'es', 'it', 'nl'].includes(a.declared) && a.declared !== f.lang) wrong.push(`${f.id}: tag ${f.lang}, feed says ${a.declared}`);
    }
    assert.deepStrictEqual(wrong, []);
    assert.deepStrictEqual(missing, [], 'feeds added after the audit: run node build/feeds-lang-audit.js');
    const checked = FEEDS.filter((f) => audit.feeds[f.id].detected).length;
    assert(checked >= FEEDS.length - 10, 'recognised ' + checked);
    console.log('       ' + checked + ' of ' + FEEDS.length + ' languages recognised from the texts, all match (audit of ' + audit.checked + ')');
  });
  await test('the newspaper filter: papers of the interface language, the switch shows all', () => {
    const esbuild = require('esbuild');
    const os = require('os');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-news-')), 'm.cjs');
    esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', '..', 'app', 'src', 'ui', 'news', 'news-lang.js')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' });
    const L = require(out);
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    const en = L.feedsFor(FEEDS, 'en'), de = L.feedsFor(FEEDS, 'de');
    assert(en.length > 50 && en.every((f) => f.lang === 'en'));
    assert(de.length > 50 && de.every((f) => f.lang === 'de'));
    assert.strictEqual(en.length + de.length, FEEDS.length);
    assert.strictEqual(L.feedsFor(FEEDS, 'en', true).length, FEEDS.length);
    assert(L.feedsFor(FEEDS, 'en', false, 'tagesschau').some((f) => f.id === 'tagesschau'), 'a paper asked for by id stays');
    const own = [{ id: 'u-1', category: 'custom', lang: 'de' }, { id: 'u-2', category: 'custom' }];
    assert.deepStrictEqual(L.feedsFor(own, 'en').map((f) => f.id), []);
    assert.deepStrictEqual(L.feedsFor(own, 'de').map((f) => f.id), ['u-1', 'u-2'], 'a feed without language counts as German');
    const cats = L.categoriesFor(CATEGORIES, L.feedsFor(FEEDS.filter((f) => f.category !== 'design'), 'en'));
    assert(cats.some((c) => c.id === 'custom') && !cats.some((c) => c.id === 'design'));
    assert.strictEqual(L.categoriesFor(CATEGORIES, en).length, CATEGORIES.length, 'every section has English papers');
    assert.strictEqual(L.categoriesFor(CATEGORIES, de).length, CATEGORIES.length, 'every section has German papers');
    assert.notStrictEqual(L.filterKey('en', false), L.filterKey('de', false));
    assert.notStrictEqual(L.filterKey('en', false), L.filterKey('en', true));
  });

  await test('categories are the neutral, uniform reading-room set', () => {
    const ids = CATEGORIES.map((c) => c.id);
    assert.deepStrictEqual(ids, ['news', 'politics', 'business', 'science', 'technology', 'culture', 'design', 'history', 'literature', 'sports', 'health', 'travel', 'custom'], ids.join(','));
    assert.strictEqual(ids[0], 'news', 'the news panel defaults to and falls back to id "news"');
    assert.strictEqual(ids[ids.length - 1], 'custom', 'custom must stay last - the panel buckets own feeds there');
    for (const c of CATEGORIES) {
      assert(c.de && c.en && c.icon && c.tagline?.de && c.tagline?.en, 'incomplete category ' + c.id);
    }
    for (const c of CATEGORIES) {
      if (c.id === 'custom') continue;
      const feeds = FEEDS.filter((f) => f.category === c.id);
      assert(feeds.length >= 8, 'category ' + c.id + ' only has ' + feeds.length + ' feeds');
      assert(feeds.some((f) => f.lang === 'de') && feeds.some((f) => f.lang === 'en'), 'category ' + c.id + ' is monolingual');
    }
    assert.strictEqual(new Set(FEEDS.map((f) => f.id)).size, FEEDS.length, 'every feed id once');
  });

  await test('legacy category ids migrate instead of orphaning feeds', () => {
    for (const [legacy, now] of Object.entries(LEGACY_CATEGORY_MAP)) {
      assert(CATEGORIES.some((c) => c.id === now), 'legacy ' + legacy + ' maps to unknown ' + now);
      assert.strictEqual(migrateCategoryId(legacy), now);
    }
    assert.strictEqual(migrateCategoryId('geopolitics'), 'politics');
    assert.strictEqual(migrateCategoryId('chess'), 'sports');
    assert.strictEqual(migrateCategoryId('news'), 'news');
    assert.strictEqual(migrateCategoryId('voellig-unbekannt'), 'custom');
    assert.strictEqual(migrateCategoryId(undefined), 'custom');
  });

  console.log('common');
  await test('sanitizeHtml removes scripts/iframes/tracking pixels and absolutizes urls', () => {
    const s = C.sanitizeHtml('<div class="x" onclick="y()"><p style="color:red">Hallo <a href="/rel">Link</a><script>x()</script><iframe src="a"></iframe><img src="/pix.gif" width="1" height="1"><img src="/img/a.jpg" alt="A"></p><form><input></form></div>', { baseUrl: 'https://example.org/news/1' });
    assert(!/script|iframe|form|input|onclick|style=/.test(s.html), s.html);
    assert(s.html.includes('href="https://example.org/rel"'), s.html);
    assert(s.html.includes('src="https://example.org/img/a.jpg"'), s.html);
    assert(!s.html.includes('pix.gif'), 'tracking pixel kept');
    assert.strictEqual(s.firstImage, 'https://example.org/img/a.jpg');
    assert.strictEqual(s.text, 'Hallo Link');
  });
  await test('decodeBuffer honours xml encoding declaration (latin1)', () => {
    const t = C.decodeBuffer(read('rss1.xml'), 'application/xml', true);
    assert(t.includes('für 2027') && t.includes('Überblick über'), t.slice(0, 300));
  });
  await test('fetchRaw resolves the final url itself after a redirect', async () => {
    const seen = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      seen.push([url, init.redirect]);
      if (url === 'https://example.org/feed') return new Response(null, { status: 301, headers: { location: 'https://cdn.example.net/feed/' } });
      return new Response('<rss></rss>', { status: 200, headers: { 'content-type': 'application/xml' } });
    };
    try {
      const r = await C.fetchRaw('https://example.org/feed');
      assert.strictEqual(r.url, 'https://cdn.example.net/feed/', 'relative links would be resolved against the wrong host');
      assert.strictEqual(r.redirects, 1);
      assert.strictEqual(seen[0][1], 'manual');
    } finally { globalThis.fetch = realFetch; }
  });

  await test('fetchRaw falls back to platform redirects when manual is opaque (Chromium)', async () => {
    const realFetch = globalThis.fetch;
    const modes = [];
    globalThis.fetch = async (url, init) => {
      modes.push(init.redirect);
      if (init.redirect === 'manual') { const r = new Response(null, { status: 0 }); Object.defineProperty(r, 'type', { value: 'opaqueredirect' }); return r; }
      return new Response('<rss></rss>', { status: 200 });
    };
    try {
      const r = await C.fetchRaw('https://example.org/feed');
      assert.deepStrictEqual(modes, ['manual', 'follow']);
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.url, 'https://example.org/feed');
    } finally { globalThis.fetch = realFetch; }
  });

  await test('fetchRaw fetches web addresses only (net.fetch would also read file: and the app\'s own schemes)', async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('secret', { status: 200 }); };
    try {
      for (const u of ['file:///C:/Users/x/settings.json', 'file:///etc/passwd', 'app://lesesaal/index.html', 'book://abc/x.epub', 'lfile://local/QQ', 'data:text/plain,hi', 'ftp://example.org/x', '', null, 'example.org/feed']) {
        await assert.rejects(() => C.fetchRaw(u), /not a web address/, 'fetched ' + u);
        await assert.rejects(() => C.fetchText(u), /not a web address/, 'fetched ' + u);
      }
      assert.strictEqual(calls, 0, 'the network was asked');
      assert.strictEqual((await C.fetchRaw('HTTP://example.org/x')).ok, true, 'a plain http address in capitals');
      assert(C.isWebAddress('https://example.org') && !C.isWebAddress('file:///x'));
    } finally { globalThis.fetch = realFetch; }
  });

  await test('fetchRaw refuses oversized responses (declared and streamed)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => (url.includes('declared')
      ? new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } })
      : new Response('x'.repeat(4000), { status: 200 }));
    try {
      await assert.rejects(() => C.fetchRaw('https://example.org/declared'), /too large/);
      await assert.rejects(() => C.fetchRaw('https://example.org/streamed', { maxBytes: 1000 }), /too large/);
      const ok = await C.fetchRaw('https://example.org/streamed', { maxBytes: 10000 });
      assert.strictEqual(ok.buffer.length, 4000);
      assert.strictEqual(ok.truncated, false);
      // podcast feeds with a long history are cut instead of refused
      const cut = await C.fetchRaw('https://example.org/streamed', { maxBytes: 1000, truncate: true });
      assert.strictEqual(cut.buffer.length, 1000);
      assert.strictEqual(cut.truncated, true);
    } finally { globalThis.fetch = realFetch; }
  });

  await test('image proxy rewrites article images when the main process installs one', () => {
    assert.strictEqual(C.hasImageProxy(), false, 'no proxy by default (tests + browser mock)');
    C.setImageProxy((u) => 'img://cache/' + Buffer.from(u, 'utf8').toString('base64url'));
    try {
      const s = C.sanitizeHtml('<p><img src="/img/a.jpg"> <img src="data:image/png;base64,AAA"></p>', { baseUrl: 'https://publisher.example/news/1' });
      const m = /src="img:\/\/cache\/([\w-]+)"/.exec(s.html);
      assert(m, s.html);
      assert.strictEqual(Buffer.from(m[1], 'base64url').toString('utf8'), 'https://publisher.example/img/a.jpg');
      assert.strictEqual(s.images[0], 'https://publisher.example/img/a.jpg', 'the original url stays available to the backend');
      assert.strictEqual(C.proxyImage('data:image/png;base64,AAA'), 'data:image/png;base64,AAA', 'data urls are left alone');
      const raw = C.sanitizeHtml('<p><img src="/img/a.jpg"></p>', { baseUrl: 'https://publisher.example/news/1', noProxy: true });
      assert(raw.html.includes('src="https://publisher.example/img/a.jpg"'));
    } finally { C.setImageProxy(null); }
  });

  await test('summarize cuts at word boundary', () => {
    const s = C.summarize('a '.repeat(400), 300);
    assert(s.length <= 302 && s.endsWith('…'));
    assert.strictEqual(C.summarize('kurz'), 'kurz');
  });

  console.log('feeds');
  let rss2;
  await test('RSS 2.0 with content:encoded → full text, images, summary, categories', async () => {
    rss2 = await feeds.parseFeedXml(read('rss2-fulltext.xml').toString(), { id: 'netzpolitik', url: 'https://netzpolitik.org/feed/', lang: 'de', category: 'news', fullText: true, title: 'netzpolitik.org' });
    assert.strictEqual(rss2.feed.title, 'netzpolitik.org');
    assert.strictEqual(rss2.feed.link, 'https://netzpolitik.org/');
    assert.strictEqual(rss2.items.length, 3);
    const a = rss2.items[0];
    assert.strictEqual(a.title, 'Chatkontrolle: Warum das Ende der Verschlüsselung alle betrifft');
    assert.strictEqual(a.author, 'Lena Brandau');
    assert(a.hasFullText && a.content.includes('<h2>Was technisch passieren soll</h2>'), 'full text missing');
    assert(a.content.includes('src="https://netzpolitik.org/wp-content/uploads/2026/09/schloss-tastatur.jpg"'), 'relative image not absolutized');
    assert(!a.content.includes('pixel.gif'), 'tracking pixel kept');
    assert.strictEqual(a.image, 'https://netzpolitik.org/wp-content/uploads/2026/09/schloss-tastatur-1200.jpg', 'media:content (largest) should win');
    assert(a.summary.startsWith('Die EU-Kommission will Messenger'), a.summary);
    assert(a.summary.length <= 305);
    assert.deepStrictEqual(a.categories, ['Überwachung', 'Europäische Union']);
    assert.strictEqual(typeof a.date, 'number');
    const b = rss2.items[1];
    assert(!b.hasFullText && b.content === null, 'short item must not be full text');
    assert.strictEqual(b.image, 'https://netzpolitik.org/wp-content/uploads/2026/09/bundestag.jpg', 'enclosure image');
    const c = rss2.items[2];
    assert.strictEqual(c.image, null, 'audio enclosure is not an image');
    assert(!/script|iframe/.test(c.summary));
  });
  await test('placeholder summaries ("None", "null", an empty body) are dropped, a real one stays', async () => {
    // a feed written by a program that prints its missing values ("None" from Python): the newspaper showed the word
    // as the summary of the item, with a drop cap ("N one")
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Zeitung</title><link>https://zeitung.example.org/</link>
      <item><title>Erster Artikel</title><link>https://zeitung.example.org/a</link><guid>a</guid><description>None</description></item>
      <item><title>Zweiter Artikel</title><link>https://zeitung.example.org/b</link><guid>b</guid><description>null</description><content:encoded><![CDATA[<div><p>&nbsp;</p></div>]]></content:encoded></item>
      <item><title>Dritter Artikel</title><link>https://zeitung.example.org/c</link><guid>c</guid><description>Eine echte Zusammenfassung, die lang genug ist, um als Kurztext des Artikels zu zählen.</description></item>
      <item><title>Vierter Artikel</title><link>https://zeitung.example.org/d</link><guid>d</guid><description>None</description><content:encoded><![CDATA[${'<p>Ein langer Absatz mit Inhalt, der nicht None ist. </p>'.repeat(40)}]]></content:encoded></item>
    </channel></rss>`;
    const r = await feeds.parseFeedXml(xml, { id: 'zeitung', url: 'https://zeitung.example.org/feed', lang: 'de', category: 'news', fullText: true });
    const by = Object.fromEntries(r.items.map((i) => [i.title, i]));
    assert.strictEqual(by['Erster Artikel'].summary, '', 'the placeholder None reached the summary');
    assert.strictEqual(by['Erster Artikel'].content, null); assert.strictEqual(by['Erster Artikel'].hasFullText, false);
    assert.strictEqual(by['Zweiter Artikel'].summary, '', 'null or an empty body reached the summary');
    assert.strictEqual(by['Zweiter Artikel'].content, null);
    assert(by['Dritter Artikel'].summary.startsWith('Eine echte Zusammenfassung'));
    assert(by['Vierter Artikel'].hasFullText && by['Vierter Artikel'].summary.startsWith('Ein langer Absatz'), 'the full text stands in for a placeholder summary');
    assert.strictEqual(C.isPlaceholderText('None'), true); assert.strictEqual(C.isPlaceholderText(' n/a '), true); assert.strictEqual(C.isPlaceholderText('<p></p>'), true);
    assert.strictEqual(C.isPlaceholderText('Nonesuch'), false); assert.strictEqual(C.isPlaceholderText('No'), false);
  });
  await test('Atom feed (html content, media:thumbnail, author)', async () => {
    const r = await feeds.parseFeedXml(read('atom.xml').toString(), { id: 'theverge', url: 'https://www.theverge.com/rss/index.xml', lang: 'en', category: 'tech', fullText: true });
    assert.strictEqual(r.feed.link, 'https://www.theverge.com/');
    assert.strictEqual(r.items.length, 2);
    const a = r.items[0];
    assert.strictEqual(a.title, "The first e-ink monitor that doesn't make me want to throw it out the window");
    assert.strictEqual(a.author, 'Sam Holloway');
    assert(a.hasFullText, 'atom full text');
    assert(a.content.includes('<figcaption>Photo by Sam Holloway'), a.content.slice(0, 200));
    assert.strictEqual(a.image, 'https://cdn.example.com/verge/eink-thumb.jpg');
    assert.strictEqual(a.link, 'https://www.theverge.com/2026/9/14/e-ink-monitor-review');
    assert(!r.items[1].hasFullText);
  });
  await test('RSS 1.0 (RDF)', async () => {
    const r = await feeds.parseFeedXml(C.decodeBuffer(read('rss1.xml'), '', true), { id: 'dw', url: 'https://rss.dw.com/rdf/rss-de-all', lang: 'de', category: 'news', fullText: 'readability' });
    assert.strictEqual(r.items.length, 2);
    assert(r.items[0].title.includes('Haushalt für 2027'));
    assert.strictEqual(r.items[0].link, 'https://www.dw.com/de/haushalt-2027/a-1');
    assert(r.items[0].date > r.items[1].date);
  });
  await test('garbage is rejected', async () => {
    await assert.rejects(() => feeds.parseFeedXml('<html><body>nope</body></html>', {}), /not a feed/);
  });
  await test('tagesschau JSON API → full text with headline, quote, image, box', () => {
    const r = feeds.parseTagesschau(json('tagesschau.json'), { id: 'tagesschau', title: 'tagesschau', category: 'news' });
    assert.strictEqual(r.items.length, 2, 'video item must be skipped');
    const a = r.items[0];
    assert.strictEqual(a.title, 'Bundestag debattiert über den Haushalt 2027');
    assert.strictEqual(a.image, 'https://images.tagesschau.de/image/abc/16x9-960.jpg', 'the 960 px variant fills the column at a third of the bytes');
    assert(a.hasFullText, 'should be full text');
    assert(a.content.includes('<h2>Streit um die Schuldenbremse</h2>'));
    assert(a.content.includes('<blockquote>Wer Schulden macht'));
    assert(a.content.includes('16x9-960.jpg') && a.content.includes('<figcaption>'));
    assert(a.content.includes('Was ist die Bereinigungssitzung?'));
    assert.strictEqual(a.kicker, 'Generaldebatte');
    assert.strictEqual(a.link, 'https://www.tagesschau.de/inland/bundestag-haushalt-2027-100.html');
    assert(!r.items[1].hasFullText, 'one-sentence story is not full text');
  });
  await test('Readability article extraction (lazy images, og:image, byline)', () => {
    const art = feeds.extractArticle(read('article.html').toString(), 'https://hakaimagazine.com/features/baltic-dead-zone/');
    assert(art, 'no article');
    assert.strictEqual(art.title, 'Why the Baltic Sea Is Turning Into a Dead Zone');
    assert(/Iris Lowell/.test(art.byline || ''), 'byline: ' + art.byline);
    assert.strictEqual(art.image, 'https://hakaimagazine.com/wp-content/uploads/baltic-hero.jpg');
    assert.strictEqual(art.siteName, 'Hakai Magazine');
    assert(art.content.includes('baltic-algae.jpg'), 'lazy image should be resolved');
    assert(!art.content.includes('data:image/gif'), 'placeholder gif kept');
    assert(art.content.includes('<blockquote>'), 'blockquote lost');
    assert(!/Comments|Great piece|analytics|<script/.test(art.content), 'boilerplate kept');
    assert(art.textContent.length > 2500, 'text too short ' + art.textContent.length);
    assert(art.readingMinutes >= 2);
    assert.strictEqual(art.published, Date.parse('2026-09-10T14:00:00+00:00'));
  });
  await test('analyseFeed + articleFromItem', () => {
    const a = feeds.analyseFeed(rss2);
    assert.strictEqual(a.itemCount, 3); assert.strictEqual(a.fullTextItems, 1); assert.strictEqual(a.imageCount, 2); assert.strictEqual(a.sample.length, 3);
    const art = feeds.articleFromItem(rss2.items[0], rss2.feed);
    assert.strictEqual(art.source, 'feed'); assert(art.textContent.length > 1500); assert(art.readingMinutes >= 2);
  });
  await test('discoverFeedUrl finds <link rel=alternate>', () => {
    const u = feeds.discoverFeedUrl('<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head></html>', 'https://blog.example.org/post');
    assert.strictEqual(u, 'https://blog.example.org/feed/');
  });

  console.log('podcasts');
  await test('iTunes podcast RSS → show + episodes with duration, image, audio', async () => {
    const r = await podcasts.parsePodcastXml(read('podcast.xml').toString(), 'https://sternengeschichten.podigee.io/feed/mp3');
    assert.strictEqual(r.show.title, 'Sternengeschichten');
    assert.strictEqual(r.show.author, 'Florian Freistetter');
    assert.strictEqual(r.show.artwork, 'https://images.podigee.com/0x,sternengeschichten-cover.jpg');
    assert.strictEqual(r.episodes.length, 3, 'item without audio must be skipped');
    const e = r.episodes[0];
    assert.strictEqual(e.title, 'Sternengeschichten Folge 640: Der Kosmische Kalender');
    assert.strictEqual(e.audio, 'https://audio.podigee-cdn.net/sternengeschichten/640.mp3');
    assert.strictEqual(e.duration, 754);
    assert.strictEqual(e.episode, 640);
    assert.strictEqual(e.image, 'https://images.podigee.com/0x,sg-640.jpg');
    assert(e.description.includes('<li>02:15 Der Urknall'), e.description);
    assert(e.summary.startsWith('Wenn man die Geschichte'));
    assert.strictEqual(r.episodes[1].duration, 754);
    assert.strictEqual(r.episodes[1].image, r.show.artwork, 'fallback to show artwork');
    assert.strictEqual(r.episodes[2].duration, 662);
    assert(r.episodes.every((x) => x.id.length === 20));
  });
  await test('a podcast episode whose description is a placeholder ("None") gets no description', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Show</title><link>https://show.example.org/</link>
      <item><title>Folge 1</title><guid>e1</guid><description>None</description><itunes:summary>None</itunes:summary><enclosure url="https://show.example.org/1.mp3" type="audio/mpeg" length="100"/></item>
      <item><title>Folge 2</title><guid>e2</guid><description>None</description><itunes:summary>Eine Folge über Bücher.</itunes:summary><enclosure url="https://show.example.org/2.mp3" type="audio/mpeg" length="100"/></item>
    </channel></rss>`;
    const r = await podcasts.parsePodcastXml(xml, 'https://show.example.org/feed');
    assert.strictEqual(r.episodes.length, 2);
    assert.strictEqual(r.episodes.find((e) => e.title === 'Folge 1').description, '', 'None reached the description');
    assert.strictEqual(r.episodes.find((e) => e.title === 'Folge 1').summary, '');
    assert.strictEqual(r.episodes.find((e) => e.title === 'Folge 2').summary, 'Eine Folge über Bücher.', 'the next field with a text is taken');
  });
  await test('a podcast feed cut in the middle of an episode still parses (large feeds)', async () => {
    const xml = read('podcast.xml').toString();
    const second = xml.indexOf('<item', xml.indexOf('</item>'));
    const cut = xml.slice(0, second + 40);   // inside the second episode
    const r = await podcasts.parsePodcastXml(podcasts.closeTruncatedFeed(cut), 'https://sternengeschichten.podigee.io/feed/mp3');
    assert.strictEqual(r.show.title, 'Sternengeschichten');
    assert.strictEqual(r.episodes.length, 1);
    assert.strictEqual(r.episodes[0].title, 'Sternengeschichten Folge 640: Der Kosmische Kalender');
  });
  await test('subscriptions of moved curated feeds get the new address', () => {
    const [oldUrl, newUrl] = Object.entries(podcasts.MOVED_FEEDS)[0];
    assert.strictEqual(podcasts.migrateSubscriptions([{ feedUrl: 'https://example.org/feed' }]), null);
    const m = podcasts.migrateSubscriptions([{ feedUrl: oldUrl, title: 'Alt' }, { feedUrl: 'https://example.org/feed' }]);
    assert.deepStrictEqual(m.map((x) => x.feedUrl), [newUrl, 'https://example.org/feed']);
    assert.strictEqual(m[0].title, 'Alt');
    // already subscribed to the new address: the old entry goes
    assert.deepStrictEqual(podcasts.migrateSubscriptions([{ feedUrl: newUrl }, { feedUrl: oldUrl }]).map((x) => x.feedUrl), [newUrl]);
    for (const u of Object.values(podcasts.MOVED_FEEDS)) assert(podcasts.CURATED.some((p) => p.feedUrl === u), u);
  });
  await test('parseDuration', () => {
    assert.strictEqual(podcasts.parseDuration('1:02:03'), 3723); assert.strictEqual(podcasts.parseDuration('90'), 90); assert.strictEqual(podcasts.parseDuration('05:00'), 300); assert.strictEqual(podcasts.parseDuration('abc'), null);
  });
  await test('OPML import (a podcast app\'s export) and export round-trip', () => {
    const list = podcasts.parseOpml(read('podcasts.opml').toString());
    assert.strictEqual(list.length, 2, JSON.stringify(list));
    assert.strictEqual(list[1].title, 'Field Notes & Friends');
    assert.strictEqual(list[0].homepage, 'https://morgenrunde.example.org');
    const xml = podcasts.buildOpml(list.map((l) => ({ title: l.title, feedUrl: l.feedUrl, homepage: l.homepage })));
    assert(xml.includes('xmlUrl="https://podcasts.example.net/fieldnotes/feed.xml"') && xml.includes('Field Notes &amp; Friends'));
    assert.strictEqual(podcasts.parseOpml(xml).length, 2);
  });
  await test('curated podcasts consistent', () => {
    const ids = new Set();
    for (const p of podcasts.CURATED) { assert(!ids.has(p.id)); ids.add(p.id); assert(/^https?:/.test(p.feedUrl)); assert(podcasts.TOPICS.some((t) => t.id === p.topic), p.id); }
    assert(podcasts.CURATED.length >= 35);
  });
  await test('mapItunesResult', () => {
    const r = podcasts.mapItunesResult({ collectionId: 1, collectionName: 'X', artistName: 'Y', artworkUrl600: 'a', feedUrl: 'f', primaryGenreName: 'g', trackCount: 3, releaseDate: '2026-01-01T00:00:00Z' });
    assert.deepStrictEqual(r, { id: '1', title: 'X', author: 'Y', artwork: 'a', feedUrl: 'f', genre: 'g', episodes: 3, lastRelease: Date.parse('2026-01-01T00:00:00Z') });
  });

  console.log('wiki');
  await test('featured feed normalisation', () => {
    const f = wiki.parseFeatured(json('wiki-featured-de.json'), 'de', '2026-09-14');
    assert.strictEqual(f.tfa.title, 'Alexander_von_Humboldt');
    assert.strictEqual(f.tfa.displayTitle, 'Alexander von Humboldt');
    assert(f.tfa.thumbnail.url.startsWith('https://upload.wikimedia.org/'));
    assert.strictEqual(f.image.description, 'Panorama des Rhonegletschers im Kanton Wallis, Schweiz.');
    assert.strictEqual(f.image.artist, 'Example User');
    assert.strictEqual(f.mostread.length, 2, 'Hauptseite must be filtered');
    assert.strictEqual(f.onthisday.length, 3);
    assert.strictEqual(f.onthisday[0].year, 1789);
    assert.strictEqual(f.onthisday[0].pages[0].displayTitle, 'Erklärung der Menschen- und Bürgerrechte');
  });
  await test('search normalisation', () => {
    const r = wiki.parseSearch(json('wiki-search.json'), 'de');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].thumbnail, 'https://upload.wikimedia.org/wikipedia/commons/thumb/r/r1/Rhone_Glacier.jpg/60px-Rhone_Glacier.jpg');
    assert.strictEqual(r[0].excerpt, 'Der Rhonegletscher ist ein Talgletscher');
  });
  await test('Parsoid page HTML sanitizing: links → data-wiki, images https, navbox/editsection/scripts removed, TOC', () => {
    const s = wiki.sanitizeWikiHtml(read('wiki-page.html').toString(), 'de', 'Rhonegletscher');
    assert(!/<script|<style|navbox|mw-editsection|Bearbeiten\]|srcset|data-mw=|rel="mw:/.test(s.html), s.html);
    assert(s.html.includes('data-wiki="Kanton Wallis"'), 'wiki link');
    assert(s.html.includes('data-wiki="Kleine Eiszeit"'));
    assert(!s.html.includes('href="./'), 'raw parsoid href left');
    assert(!s.html.includes('data-wiki="Kategorie'), 'category link should be unwrapped');
    assert(!s.html.includes('data-wiki="Nicht existierender'), 'red link should be unwrapped');
    assert(/<a [^>]*href="https:\/\/www\.gletscherarchiv\.de\/rhone"[^>]*data-ext="1"/.test(s.html) || /<a [^>]*data-ext="1"[^>]*href="https:\/\/www\.gletscherarchiv\.de\/rhone"/.test(s.html), 'external link');
    assert(s.html.includes('src="https://upload.wikimedia.org/wikipedia/commons/thumb/r/r1/Rhone_Glacier.jpg/260px-Rhone_Glacier.jpg"'), 'image url');
    assert(s.html.includes('class="infobox float-right"'), 'infobox class kept');
    assert(s.html.includes('class="wikitable"'));
    assert(s.html.includes('data-anchor="cite_note-1"'), 'reference link to same page should become an anchor');
    assert(!s.html.includes('data-wiki="Rhonegletscher"'), 'self links must not navigate');
    assert(!s.html.includes('Weblinks'), 'Weblinks section should be removed');
    assert(!s.html.includes('mw-cite-backlink'));
    assert.deepStrictEqual(s.toc.map((t) => t.text), ['Geographie', 'Gletschersee', 'Rückzug seit 1850', 'Einzelnachweise']);
    assert.strictEqual(s.toc[0].id, 'Geographie');
    assert(s.text.includes('Der Rhonegletscher (französisch Glacier du Rhône) ist ein Talgletscher'));
    assert.strictEqual(s.firstImage, 'https://upload.wikimedia.org/wikipedia/commons/thumb/r/r1/Rhone_Glacier.jpg/260px-Rhone_Glacier.jpg');
  });
  await test('wikiTitleFromHref', () => {
    assert.deepStrictEqual(wiki.wikiTitleFromHref('./Kanton_Wallis#Geo', 'de'), { title: 'Kanton Wallis', frag: 'Geo' });
    assert.deepStrictEqual(wiki.wikiTitleFromHref('/wiki/Rh%C3%B4ne', 'de'), { title: 'Rhône', frag: null });
    assert.deepStrictEqual(wiki.wikiTitleFromHref('https://de.wikipedia.org/wiki/Bern', 'de'), { title: 'Bern', frag: null });
    assert.strictEqual(wiki.wikiTitleFromHref('https://en.wikipedia.org/wiki/Bern', 'de'), null);
    assert.strictEqual(wiki.wikiTitleFromHref('https://example.org/x', 'de'), null);
  });

  console.log('dict');
  await test('en.wiktionary definition (German word → English glosses)', () => {
    const r = dict.parseWiktionaryDefinition(json('wiktionary-definition.json'), 'de');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].partOfSpeech, 'Noun');
    assert.strictEqual(r[0].definitions[0].definition, 'house, building');
    assert.strictEqual(r[0].definitions[0].examples[0], 'Das Haus steht am Fluss.');
    assert.strictEqual(r[0].definitions[1].definition, 'home, household');
    assert.deepStrictEqual(dict.parseWiktionaryDefinition(json('wiktionary-definition.json'), 'en'), []);
  });
  await test('en.wiktionary definition (English word)', () => {
    const r = dict.parseWiktionaryDefinition(json('wiktionary-definition-en.json'), 'en');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[1].partOfSpeech, 'Verb');
    assert.strictEqual(r[1].definitions[0].examples[0], 'The car is housed in the garage.');
  });
  await test('de.wiktionary "Bedeutungen" extraction', () => {
    const r = dict.parseDeWiktionaryHtml(json('dewiktionary-parse.json').parse.text);
    assert.strictEqual(r.length, 2, JSON.stringify(r));
    assert.strictEqual(r[0].partOfSpeech, 'Substantiv, n');
    assert.strictEqual(r[0].partOfSpeechEn, 'noun');
    assert.strictEqual(r[0].definitions.length, 3);
    assert.strictEqual(r[0].definitions[0].definition, 'Gebäude, das Menschen zum Wohnen dient');
    assert.deepStrictEqual(r[0].definitions[0].examples, ['Das Haus hat drei Stockwerke.', 'Wir bauen ein Haus am Stadtrand.']);
    assert.strictEqual(r[0].definitions[2].examples[0], 'Das Haus Siemens hat eine lange Tradition.');
    assert.deepStrictEqual(r[0].synonyms, ['Gebäude, Bau', 'Familie, Geschlecht']);
    assert.strictEqual(r[1].partOfSpeech, 'Verb');
    assert.strictEqual(r[1].definitions[0].definition, 'veraltet: wohnen');
  });
  await test('MyMemory response', () => {
    const r = dict.parseMyMemory(json('mymemory.json'));
    assert.strictEqual(r.translated, 'The library is open until midnight.');
    assert.strictEqual(r.alternatives.length, 1);
    assert.throws(() => dict.parseMyMemory({ responseStatus: 403, responseDetails: 'quota' }), /quota/);
  });

  // ---- IPC smoke test: register() against a fake ipcMain/app with stubbed network -----------------------------
  console.log('ipc (offline, stubbed fetch)');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-feeds-'));
  const handlers = {};
  const broadcasts = [];
  const fakeCtx = { ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } }, app: { getPath: () => tmp, on() {} }, settings: { get: () => null }, broadcast: (ch, p) => broadcasts.push([ch, p]), getMainWindow: () => null, dialog: {}, library: null, lfileUrl: (p) => p };
  const call = (ch, ...args) => handlers[ch]({}, ...args);
  const routes = {
    'https://netzpolitik.org/feed/': () => ({ ok: true, status: 200, url: 'https://netzpolitik.org/feed/', text: read('rss2-fulltext.xml').toString() }),
    'https://www.tagesschau.de/api2u/news/': () => ({ ok: true, status: 200, text: read('tagesschau.json').toString() }),
    'https://blog.example.org/': () => ({ ok: true, status: 200, url: 'https://blog.example.org/', text: '<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>' }),
    'https://blog.example.org/atom.xml': () => ({ ok: true, status: 200, url: 'https://blog.example.org/atom.xml', text: read('atom.xml').toString() }),
    'https://hakaimagazine.com/features/baltic/': () => ({ ok: true, status: 200, url: 'https://hakaimagazine.com/features/baltic/', text: read('article.html').toString() }),
    'https://sternengeschichten.podigee.io/feed/mp3': () => ({ ok: true, status: 200, text: read('podcast.xml').toString() }),
    'https://de.wikipedia.org/api/rest_v1/page/summary/Rhonegletscher?redirect=true': () => ({ ok: true, status: 200, text: JSON.stringify({ title: 'Rhonegletscher', displaytitle: 'Rhonegletscher', description: 'Gletscher in der Schweiz', extract: 'Der Rhonegletscher …', content_urls: { desktop: { page: 'https://de.wikipedia.org/wiki/Rhonegletscher' } } }) }),
    'https://de.wikipedia.org/api/rest_v1/page/html/Rhonegletscher?redirect=true': () => ({ ok: true, status: 200, text: read('wiki-page.html').toString() }),
    'https://en.wiktionary.org/api/rest_v1/page/definition/Haus?redirect=true': () => ({ ok: true, status: 200, text: read('wiktionary-definition.json').toString() }),
    'https://api.mymemory.translated.net/get?q=Die%20Bibliothek%20ist%20bis%20Mitternacht%20ge%C3%B6ffnet.&langpair=de|en': () => ({ ok: true, status: 200, text: read('mymemory.json').toString() }),
  };
  let fetchCount = 0;
  C.fetchText = async (url) => { fetchCount++; const r = routes[url]; if (!r) { if (url.startsWith('https://de.wiktionary.org/')) return { ok: true, status: 200, text: JSON.stringify(json('dewiktionary-parse.json')) }; const e = new Error('ENOTFOUND ' + url); throw e; } return { contentType: 'text/xml', ...r() }; };
  C.fetchJson = async (url) => { const r = await C.fetchText(url); if (!r.ok) throw new Error('HTTP ' + r.status); return JSON.parse(r.text); };
  // a feeds-state.json written by an older version: legacy category + stale health/index keys
  fs.writeFileSync(path.join(tmp, 'feeds-state.json'), JSON.stringify({
    userFeeds: [{ id: 'u-legacy', title: 'Alter Feed', url: 'https://legacy.example/feed', lang: 'de', category: 'geopolitics', custom: true, fullText: 'readability' }],
    read: {}, health: { 'gone-adhoc': { status: 'ok' }, netzpolitik: { status: 'ok' } }, index: { 'gone-adhoc': { ids: [] } },
  }));
  for (const m of ['feeds', 'podcasts', 'wiki', 'dict']) require('./' + m).register(fakeCtx);

  await test('register() migrates stored feed categories and prunes orphaned state', async () => {
    const list = await call('feeds:list');
    const legacy = list.feeds.find((f) => f.id === 'u-legacy');
    assert(legacy, 'user feed lost');
    assert.strictEqual(legacy.category, 'politics', 'legacy category id was not migrated');
    assert(list.categories.some((c) => c.id === legacy.category), 'migrated feed would be invisible in the panel');
    await new Promise((r) => setTimeout(r, 700));   // the store writes debounced
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'feeds-state.json'), 'utf8'));
    assert(!raw.health['gone-adhoc'] && !raw.index['gone-adhoc'], 'stale ad-hoc state kept');
    assert(raw.health.netzpolitik, 'health of a real feed must survive');
    assert.strictEqual(typeof list.health?.running, 'boolean', 'feeds:list must report the health-check state');
  });

  await test('feeds:list returns categories + decorated feeds', async () => {
    const r = await call('feeds:list');
    assert(r.categories.length === CATEGORIES.length && r.feeds.length === FEEDS.length + 1, 'curated feeds + the migrated user feed');
    assert.strictEqual(r.feeds[0].health.status, 'unknown');
  });
  await test('feeds:fetch (RSS) → cache → unread → markRead', async () => {
    const r = await call('feeds:fetch', 'netzpolitik');
    assert.strictEqual(r.items.length, 3); assert(!r.fromCache);
    const again = await call('feeds:fetch', 'netzpolitik');
    assert(again.fromCache, 'second call should be served from cache');
    const list = await call('feeds:list');
    const f = list.feeds.find((x) => x.id === 'netzpolitik');
    assert.strictEqual(f.unread, 3); assert.strictEqual(f.health.status, 'ok');
    const m = await call('feeds:markRead', 'netzpolitik', r.items[0].id);
    assert.strictEqual(m.unread, 2);
    assert((await call('feeds:fetch', 'netzpolitik')).items[0].read === true);
    assert.strictEqual((await call('feeds:readState')).read[r.items[0].id] > 0, true);
    assert.strictEqual((await call('feeds:markAllRead', 'netzpolitik')).unread, 0);
  });
  await test('feeds:fetch (tagesschau JSON) and feeds:article from feed content', async () => {
    const r = await call('feeds:fetch', 'tagesschau');
    assert.strictEqual(r.feed.type, 'tagesschau'); assert.strictEqual(r.items.length, 2);
    const art = await call('feeds:article', r.items[0].link, 'tagesschau');
    assert.strictEqual(art.source, 'tagesschau'); assert(art.content.includes('Schuldenbremse'));
    assert((await call('feeds:article', r.items[0].link, 'tagesschau')).fromCache);
  });
  await test('feeds:article via Readability for a page', async () => {
    const art = await call('feeds:article', 'https://hakaimagazine.com/features/baltic/', 'biographic');
    assert.strictEqual(art.source, 'readability'); assert(art.title.startsWith('Why the Baltic'));
  });
  await test('feeds:check discovers a feed on an HTML page; feeds:add / remove', async () => {
    const c = await call('feeds:check', 'blog.example.org');
    assert(c.ok, c.error); assert.strictEqual(c.url, 'https://blog.example.org/atom.xml'); assert.strictEqual(c.itemCount, 2); assert.strictEqual(c.title, 'The Verge - All Posts');
    const f = await call('feeds:add', 'https://blog.example.org/', 'tech', 'en');   // legacy id on purpose
    assert(f.custom && f.id.startsWith('u-') && f.category === 'technology');
    assert((await call('feeds:list')).feeds.some((x) => x.id === f.id));
    await assert.rejects(() => call('feeds:add', 'https://blog.example.org/', 'technology', 'en'), /bereits|exists/);
    assert.strictEqual(await call('feeds:remove', f.id), true);
    assert(!(await call('feeds:list')).feeds.some((x) => x.id === f.id));
  });
  await test('feeds:health marks broken feeds and broadcasts progress', async () => {
    const r = await call('feeds:health', ['netzpolitik', 'dw-de']);
    assert(r.started);
    await new Promise((res) => { const t = setInterval(() => { if (broadcasts.some(([, p]) => p.type === 'health-done')) { clearInterval(t); res(); } }, 20); });
    const list = await call('feeds:list');
    assert.strictEqual(list.feeds.find((x) => x.id === 'dw-de').health.status, 'broken');
    assert(/nicht erreichbar.*ENOTFOUND/.test(list.feeds.find((x) => x.id === 'dw-de').health.error), list.feeds.find((x) => x.id === 'dw-de').health.error);
    assert.strictEqual(list.feeds.find((x) => x.id === 'netzpolitik').health.status, 'ok');
  });
  await test('podcasts: subscribe → episodes (cached) → positions → opml export string', async () => {
    const sub = await call('podcasts:subscribe', 'https://sternengeschichten.podigee.io/feed/mp3');
    assert.strictEqual(sub.title, 'Sternengeschichten'); assert.strictEqual(sub.episodeCount, 3);
    const eps = await call('podcasts:episodes', 'https://sternengeschichten.podigee.io/feed/mp3');
    assert(eps.fromCache && eps.episodes.length === 3);
    const pos = await call('podcasts:setPosition', eps.episodes[0].id, 123.6, false);
    assert.strictEqual(pos.seconds, 124);
    assert.strictEqual((await call('podcasts:episodes', 'https://sternengeschichten.podigee.io/feed/mp3')).episodes[0].position.seconds, 124);
    assert.strictEqual((await call('podcasts:positions'))[eps.episodes[0].id].seconds, 124);
    const curated = await call('podcasts:curated');
    assert.strictEqual(curated.podcasts.length >= 35, true);
    // a show opened once keeps its cover in the recommendations
    assert.strictEqual(curated.podcasts.find((p) => p.id === 'sternengeschichten').artwork, 'https://images.podigee.com/0x,sternengeschichten-cover.jpg');
    assert.strictEqual(curated.podcasts.find((p) => p.id === 'radiolab').artwork, null);
    assert.strictEqual(await call('podcasts:unsubscribe', 'https://sternengeschichten.podigee.io/feed/mp3'), true);
    assert.strictEqual((await call('podcasts:subscriptions')).length, 0);
  });
  await test('wiki:page (REST html) sanitized + cached', async () => {
    const p = await call('wiki:page', 'de', 'Rhonegletscher');
    assert.strictEqual(p.title, 'Rhonegletscher'); assert(p.html.includes('data-wiki="Kanton Wallis"')); assert.strictEqual(p.toc.length, 4); assert.strictEqual(p.description, 'Gletscher in der Schweiz');
    assert((await call('wiki:page', 'de', 'Rhonegletscher')).fromCache);
  });
  await test('dict:define (de) merges de.wiktionary Bedeutungen + English glosses; dict:translate', async () => {
    const d = await call('dict:define', 'Haus', 'de');
    assert.strictEqual(d.entries[0].definitions[0].definition, 'Gebäude, das Menschen zum Wohnen dient');
    assert.strictEqual(d.glosses[0].definitions[0].definition, 'house, building');
    assert.deepStrictEqual(d.source, ['en.wiktionary', 'de.wiktionary']);
    const t = await call('dict:translate', 'Die Bibliothek ist bis Mitternacht geöffnet.', 'de', 'en');
    assert.strictEqual(t.translated, 'The library is open until midnight.');
    assert.strictEqual(t.source, 'mymemory');
  });
  await test('cache files landed in userData/feeds-cache', () => {
    assert(fs.existsSync(path.join(tmp, 'feeds-cache', 'netzpolitik.json')));
    assert(fs.existsSync(path.join(tmp, 'feeds-cache', 'articles')));
    assert(fs.existsSync(path.join(tmp, 'feeds-cache', 'wiki')));
    assert(fs.existsSync(path.join(tmp, 'feeds-cache', 'podcasts')));
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
