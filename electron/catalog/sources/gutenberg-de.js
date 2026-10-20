// Projekt Gutenberg-DE (https://projekt-gutenberg.org) – the large German-language public-domain
// collection. The site was relaunched: works now live at /authors/<autor>/books/<werk>/ and are read
// chapter by chapter (/chapter/1, /chapter/2 …); the old <autor>/<werk>/ URLs and the
// /info/texte/allwork*.html indexes are gone (they 404 / redirect to /bibliothek/).
//
// There is no API, so this source uses the site's own directories, cached per page on disk:
//   /bibliothek/?gl_letter=<A–Z>&gl_page=<n>   – works, alphabetically by title, 100 per page
//   /autoren/?gl_letter=<A–Z>&gl_page=<n>      – authors, alphabetically by surname, 100 per page
//   /authors/<slug>/                           – every work of one author
//   /bibliothek/meistgelesen/ , /bibliothek/neu-in-der-bibliothek/
'use strict';
const U = require('./util');
const C = require('../../feeds/common');

const SITE = 'https://projekt-gutenberg.org';
const LIB = SITE + '/bibliothek/';
const AUTHORS_INDEX = SITE + '/autoren/';
const INDEX_TTL = 7 * 24 * 3600 * 1000;
const LIMIT = 24;
const PER_PAGE = 100;              // entries the site puts on one directory page
const MAX_PAGES_PER_LETTER = 15;   // "D" alone has 38 pages – load a window, not everything
const MAX_AUTHOR_PAGES = 6;

// curated fallback / "Klassiker" chip – slugs verified against the live site
const CURATED = [
  ['authors/johann-wolfgang-von-goethe/books/faust-eine-tragoedie', 'Faust. Eine Tragödie', 'Johann Wolfgang von Goethe'],
  ['authors/johann-wolfgang-von-goethe/books/die-leiden-des-jungen-werther', 'Die Leiden des jungen Werther', 'Johann Wolfgang von Goethe'],
  ['authors/franz-kafka/books/die-verwandlung', 'Die Verwandlung', 'Franz Kafka'],
  ['authors/franz-kafka/books/der-prozess', 'Der Prozeß', 'Franz Kafka'],
  ['authors/theodor-fontane/books/effi-briest', 'Effi Briest', 'Theodor Fontane'],
  ['authors/friedrich-schiller/books/die-raeuber', 'Die Räuber', 'Friedrich Schiller'],
  ['authors/friedrich-schiller/books/friedrich-schiller-wilhelm-tell', 'Wilhelm Tell', 'Friedrich Schiller'],
  ['authors/friedrich-schiller/books/friedrich-schiller-kabale-und-liebe', 'Kabale und Liebe', 'Friedrich Schiller'],
  ['authors/gotthold-ephraim-lessing/books/nathan-der-weise', 'Nathan der Weise', 'Gotthold Ephraim Lessing'],
  ['authors/gotthold-ephraim-lessing/books/emilia-galotti', 'Emilia Galotti', 'Gotthold Ephraim Lessing'],
  ['authors/heinrich-von-kleist/books/heinrich-von-kleist-der-zerbrochne-krug', 'Der zerbrochne Krug', 'Heinrich von Kleist'],
  ['authors/eta-hoffmann/books/eta-hoffmann-der-sandmann', 'Der Sandmann', 'E. T. A. Hoffmann'],
  ['authors/theodor-storm/books/theodor-storm-der-schimmelreiter', 'Der Schimmelreiter', 'Theodor Storm'],
  ['authors/brueder-grimm/books/kinder-und-hausmaerchen', 'Kinder- und Hausmärchen', 'Brüder Grimm'],
  ['authors/stefan-zweig/books/schachnovelle', 'Schachnovelle', 'Stefan Zweig'],
  ['authors/thomas-mann/books/buddenbrooks', 'Buddenbrooks', 'Thomas Mann'],
  ['authors/friedrich-wilhelm-nietzsche/books/also-sprach-zarathustra-ein-buch-fuer-alle-und-keinen', 'Also sprach Zarathustra', 'Friedrich Nietzsche'],
  ['authors/gottfried-keller/books/g-keller-kleider-machen-leute', 'Kleider machen Leute', 'Gottfried Keller'],
  ['authors/heinrich-heine/books/heinrich-heine-deutschland-ein-wintermaerchen', 'Deutschland. Ein Wintermärchen', 'Heinrich Heine'],
  ['authors/hans-jakob-christoffel-von-grimmelshausen/books/grimmelshausen-simplicius-simplicissimus', 'Simplicius Simplicissimus', 'Grimmelshausen'],
];

const AUTHOR_CHIPS = { goethe: 'johann-wolfgang-von-goethe', schiller: 'friedrich-schiller', fontane: 'theodor-fontane', kafka: 'franz-kafka' };

const source = {
  id: 'gutenberg-de', name: 'Projekt Gutenberg-DE', icon: '🇩🇪', kind: 'books', lang: ['de'], canSearch: true,
  description: { de: 'Die große deutschsprachige Sammlung gemeinfreier Literatur, kapitelweise online lesbar und auf Wunsch als EPUB zusammengefügt.', en: 'The large German public-domain collection – readable chapter by chapter, optionally stitched into an EPUB.' },
  chips: [
    { id: 'meistgelesen', label: { de: 'Meistgelesen', en: 'Most read' } },
    { id: 'neu', label: { de: 'Neu in der Bibliothek', en: 'Recently added' } },
    { id: 'classics', label: { de: 'Klassiker (Auswahl)', en: 'Classics (selection)' } },
    { id: 'goethe', label: { de: 'Goethe', en: 'Goethe' } },
    { id: 'schiller', label: { de: 'Schiller', en: 'Schiller' } },
    { id: 'fontane', label: { de: 'Fontane', en: 'Fontane' } },
    { id: 'kafka', label: { de: 'Kafka', en: 'Kafka' } },
    { id: 'maerchen', label: { de: 'Märchen', en: 'Fairy tales' } },
    { id: 'gedichte', label: { de: 'Gedichte', en: 'Poems' } },
  ],

  async search(query, opts, deps) {
    const p = U.page(opts);
    const words = fold(U.norm(query)).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return U.result([], { total: 0, page: 1, hasMore: false });
    const { works, note } = await collect(words, deps);
    const scored = works.map((w) => ({ w, s: score(w, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.w.title.localeCompare(b.w.title, 'de'));
    const slice = scored.slice((p - 1) * LIMIT, p * LIMIT).map((x) => toItem(x.w));
    return U.result(slice, {
      total: scored.length, page: p, hasMore: p * LIMIT < scored.length,
      note: scored.length ? note : (note || 'Nichts gefunden. Die Bibliothek ist alphabetisch nach Titel geordnet, mit dem Autorennamen (»Kafka«) findest du am meisten.'),
    });
  },

  async browse(browseId, opts, deps) {
    const p = U.page(opts);
    const { net } = deps;
    if (!browseId || browseId === 'classics') return U.result(CURATED.map(([path, title, author]) => toItem({ path, title, author })), { total: CURATED.length, page: 1, hasMore: false });
    if (AUTHOR_CHIPS[browseId]) {
      const works = await authorWorks(net, AUTHOR_CHIPS[browseId]);
      return U.result(works.slice((p - 1) * LIMIT, p * LIMIT).map(toItem), { total: works.length, page: p, hasMore: p * LIMIT < works.length });
    }
    if (browseId === 'maerchen' || browseId === 'gedichte') {
      const word = browseId === 'maerchen' ? 'maerchen' : 'gedichte';
      const { works, note } = await collect([word], deps);
      const hits = works.filter((w) => fold(w.title).includes(word));
      return U.result(hits.slice((p - 1) * LIMIT, p * LIMIT).map(toItem), { total: hits.length, page: p, hasMore: p * LIMIT < hits.length, note });
    }
    const url = browseId === 'neu' ? LIB + 'neu-in-der-bibliothek/' : LIB + 'meistgelesen/';
    let list;
    try { list = await listPage(net, url, p); } catch (e) {
      return U.result(CURATED.map(([path, title, author]) => toItem({ path, title, author })), { page: 1, hasMore: false, note: 'Die Bibliotheksliste ist gerade nicht erreichbar (' + e.message + '). Hier ist die Auswahl der Klassiker.' });
    }
    return U.result(list.works.slice(0, LIMIT * 2).map(toItem), { total: list.total, page: p, hasMore: list.works.length >= PER_PAGE / 2 });
  },
};

// --- item -------------------------------------------------------------------------------------------
function workUrl(path) {
  if (/^https?:/i.test(path)) return String(path).replace(/\/?$/, '/');
  return `${SITE}/${String(path).replace(/^\/+|\/+$/g, '')}/`;
}

function toItem(w) {
  const url = workUrl(w.path);
  return U.mkItem('gutenberg-de', String(w.path).replace(/^\/+|\/+$/g, ''), {
    title: w.title, author: w.author || null, language: 'de',
    description: w.author ? `${w.author}: ${w.title} · Projekt Gutenberg-DE` : 'Projekt Gutenberg-DE',
    formats: [{ type: 'epub', url: 'build://epub', label: 'EPUB (aus Kapiteln)' }, { type: 'html', url, label: 'HTML' }],
    readOnlineUrl: url, license: 'Gemeinfrei', canRead: true, kind: 'web',
    // the new pages carry no usable cover (og:image is a generic EPUB logo) → the panel draws a typographic one
    meta: { web: true, url, follow: true, site: 'projekt-gutenberg.org' },
  });
}

// --- searching --------------------------------------------------------------------------------------
/** Fold German text for comparisons: lower case, umlauts/ß expanded, diacritics removed. */
function fold(s) {
  return String(s || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const letterOf = (w) => { const c = fold(w)[0]; return c >= 'a' && c <= 'z' ? c.toUpperCase() : null; };

function score(w, words) {
  const t = fold(w.title), a = fold(w.author || '');
  let s = 0;
  for (const x of words) {
    if (t === x) s += 6;
    else if (t.startsWith(x)) s += 4;
    else if (t.includes(x)) s += 2.5;
    else if (a.includes(x)) s += 2;
    else return 0;
  }
  return s;
}

/** Works that can match `words`: the alphabetical title window plus everything by matching authors. */
async function collect(words, { net }) {
  const out = new Map();
  const notes = [];
  const letters = [...new Set(words.map(letterOf).filter(Boolean))].slice(0, 3);
  await Promise.all(letters.map(async (letter) => {
    const word = words.find((w) => letterOf(w) === letter);
    try {
      const r = await letterWorks(net, letter, word);
      for (const w of r.works) out.set(w.path, w);
      if (r.partial) notes.push(`Der Buchstabe ${letter} hat sehr viele Titel. Gezeigt wird der alphabetische Ausschnitt um »${word}«.`);
    } catch (e) { notes.push(`Werkverzeichnis ${letter} nicht ladbar (${e.message})`); }
  }));
  // author route: the surname index is small and an author page lists all of their works
  await Promise.all(letters.map(async (letter) => {
    try {
      const authors = await authorIndex(net, letter);
      const hits = authors.filter((a) => words.some((w) => fold(a.name).includes(w))).slice(0, 3);
      for (const a of hits) for (const w of await authorWorks(net, a.slug)) out.set(w.path, w);
    } catch { /* the title route may still have produced something */ }
  }));
  if (!out.size) for (const [path, title, author] of CURATED) out.set(path, { path, title, author });
  return { works: [...out.values()], note: notes.length ? notes.join(' · ') : null };
}

// --- directory pages --------------------------------------------------------------------------------
/** Parse a /bibliothek/ or /authors/<slug>/ listing: { works: [{path,title,author}], total }. */
function parseIndex(html, baseUrl) {
  const doc = C.parseHtml(html);
  const out = [], seen = new Set();
  const items = [...doc.querySelectorAll('.book-app__index-item')];
  const nodes = items.length ? items : [...doc.querySelectorAll('li, tr, p, div')];
  for (const li of nodes) {
    const a = li.querySelector ? li.querySelector('a[href*="/books/"]') : null;
    if (!a) continue;
    const href = C.absolutize(a.getAttribute('href'), baseUrl) || a.getAttribute('href');
    const m = /\/authors\/([a-z0-9-]+)\/books\/([a-z0-9-]+)\/?$/i.exec(String(href).split('?')[0]);
    if (!m) continue;
    const path = `authors/${m[1]}/books/${m[2]}`;
    if (seen.has(path)) continue;
    let title = C.collapseWs(li.querySelector('.book-app__index-title')?.textContent || a.textContent).replace(/^#\d+\s*/, '');
    const author = C.collapseWs(li.querySelector('.book-app__index-meta')?.textContent || '') || slugToName(m[1]);
    if (!title) continue;
    // "Friedrich Schiller: Wilhelm Tell" → "Wilhelm Tell" (the author is shown in its own line)
    if (author && title.toLowerCase().startsWith(author.toLowerCase() + ':')) title = C.collapseWs(title.slice(author.length + 1));
    seen.add(path);
    out.push({ path, title, author });
  }
  const m = /([\d.]+)\s*(?:Bücher|Titel|Werke)/i.exec(C.collapseWs(doc.body ? doc.body.textContent : ''));
  return { works: out, total: m ? parseInt(m[1].replace(/\./g, ''), 10) : null };
}

function slugToName(slug) {
  return String(slug || '').split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Parse /autoren/: [{ slug, name }]. */
function parseAuthorIndex(html, baseUrl) {
  const doc = C.parseHtml(html);
  const out = [], seen = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = C.absolutize(a.getAttribute('href'), baseUrl) || a.getAttribute('href');
    const m = /\/authors\/([a-z0-9-]+)\/?$/i.exec(String(href).split('?')[0]);
    if (!m || seen.has(m[1])) continue;
    const name = C.collapseWs(a.textContent);
    if (!name || name.length > 90) continue;
    seen.add(m[1]);
    out.push({ slug: m[1], name: /,/.test(name) ? U.flipName(name) : name });
  }
  return out;
}

async function cached(net, key, ttl, fn) {
  const c = net.cache.get(key);
  if (c && Date.now() - c.at < ttl && c.data) return c.data;
  const data = await fn();
  net.cache.set(key, data);
  return data;
}

/** One directory page (cached for a week). */
function listPage(net, url, page) {
  const full = page > 1 ? url + (url.includes('?') ? '&' : '?') + 'gl_page=' + page : url;
  return cached(net, 'pgde:' + full, INDEX_TTL, async () => {
    const r = await net.text(full, { timeout: 40000 });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const parsed = parseIndex(r.text, r.url || full);
    if (!parsed.works.length) throw new Error('keine Werke auf dieser Seite');
    return parsed;
  });
}

/** All works of one letter – capped; for bigger letters an alphabetical window around `needle`. */
async function letterWorks(net, letter, needle) {
  const url = `${LIB}?gl_letter=${encodeURIComponent(letter)}`;
  const first = await listPage(net, url, 1);
  const pages = Math.max(1, Math.ceil((first.total || first.works.length) / PER_PAGE));
  let wanted, partial = false;
  if (pages <= MAX_PAGES_PER_LETTER) wanted = range(2, pages);
  else {
    partial = true;
    const hit = await locate(net, url, pages, needle);
    wanted = [...new Set([2, 3, hit - 1, hit, hit + 1, hit + 2, hit + 3])].filter((n) => n >= 2 && n <= pages);
  }
  const limit = C.pLimit(2);
  const rest = await Promise.all(wanted.map((n) => limit(() => listPage(net, url, n).catch(() => ({ works: [] })))));
  const works = [...first.works];
  for (const r of rest) works.push(...r.works);
  const seen = new Set();
  return { works: works.filter((w) => !seen.has(w.path) && seen.add(w.path)), partial, total: first.total };
}

/** Binary search for the page where `needle` would sit, using the listing's alphabetical order. */
async function locate(net, url, pages, needle) {
  const key = fold(needle || '');
  if (!key) return 1;
  let lo = 1, hi = pages, best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let page;
    try { page = await listPage(net, url, mid); } catch { break; }
    const firstTitle = fold(page.works[0] ? page.works[0].title : '');
    if (firstTitle && firstTitle <= key) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Every work of one author (their page lists them all, paged). */
async function authorWorks(net, slug) {
  const url = `${SITE}/authors/${encodeURIComponent(slug)}/`;
  const out = [];
  for (let p = 1; p <= MAX_AUTHOR_PAGES; p++) {
    let r;
    try { r = await listPage(net, url, p); } catch { break; }
    out.push(...r.works);
    if (r.works.length < PER_PAGE) break;
  }
  const seen = new Set();
  return out.filter((w) => !seen.has(w.path) && seen.add(w.path));
}

/** The author directory for one letter (100 per page, a handful of pages at most). */
function authorIndex(net, letter) {
  const url = `${AUTHORS_INDEX}?gl_letter=${encodeURIComponent(letter)}`;
  return cached(net, 'pgde-authors:' + letter, INDEX_TTL, async () => {
    const out = [];
    for (let p = 1; p <= MAX_AUTHOR_PAGES; p++) {
      const full = p > 1 ? url + '&gl_page=' + p : url;
      const r = await net.text(full, { timeout: 40000 });
      if (!r.ok) break;
      const list = parseAuthorIndex(r.text, r.url || full);
      out.push(...list);
      if (list.length < PER_PAGE) break;
    }
    const seen = new Set();
    return out.filter((a) => !seen.has(a.slug) && seen.add(a.slug));
  });
}

function range(from, to) { const out = []; for (let i = from; i <= to; i++) out.push(i); return out; }

module.exports = { ...source, parseIndex, parseAuthorIndex, toItem, workUrl, fold, score, CURATED, SITE };
