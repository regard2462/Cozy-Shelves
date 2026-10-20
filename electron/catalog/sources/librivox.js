// LibriVox – free public-domain audiobooks read by volunteers. Each book is a podcast-style RSS feed,
// which the podcast player can subscribe to.
'use strict';
const U = require('./util');

const API = 'https://librivox.org/api/feed/audiobooks/';
const LIMIT = 20;
const LANG_NAME = { de: 'German', en: 'English' };
const GENRES = { poetry: 'Poetry', fairy: 'Myths, Legends & Fairy Tales', philosophy: 'Philosophy', history: 'History', fiction: 'General Fiction', children: "Children's Fiction", short: 'Short Stories', adventure: 'Action & Adventure Fiction', plays: 'Plays', religion: 'Religion' };

const source = {
  id: 'librivox', name: 'LibriVox', icon: '🎧', kind: 'audiobooks', lang: ['en', 'de'], canSearch: true,
  description: { de: 'Gemeinfreie Hörbücher, gelesen von Freiwilligen. Sie laufen direkt im Podcast-Player.', en: 'Public-domain audiobooks read by volunteers – plays right in the podcast player.' },
  chips: [
    { id: 'german', label: { de: 'Deutsche Hörbücher', en: 'German audiobooks' } },
    { id: 'recent', label: { de: 'Neu erschienen', en: 'Recent releases' } },
    { id: 'fiction', label: { de: 'Romane', en: 'Fiction' } },
    { id: 'poetry', label: { de: 'Lyrik', en: 'Poetry' } },
    { id: 'fairy', label: { de: 'Märchen & Sagen', en: 'Fairy tales' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'children', label: { de: 'Für Kinder', en: 'Children' } },
    { id: 'short', label: { de: 'Kurzgeschichten', en: 'Short stories' } },
    { id: 'plays', label: { de: 'Hörspiele', en: 'Plays' } },
  ],

  async search(query, opts, { net }) {
    const p = U.page(opts);
    const q = U.norm(query);
    const base = { format: 'json', extended: '1', limit: String(LIMIT), offset: String((p - 1) * LIMIT) };
    if (LANG_NAME[opts?.lang]) base.language = LANG_NAME[opts.lang];
    // title and author searches run in parallel; results merged (title matches first)
    const [byTitle, byAuthor] = await Promise.all([
      net.jsonLenient(API + '?' + new URLSearchParams({ ...base, title: q })).then(booksOf, () => []),
      p === 1 ? net.jsonLenient(API + '?' + new URLSearchParams({ ...base, author: q.split(/\s+/).pop() })).then(booksOf, () => []) : Promise.resolve([]),
    ]);
    const seen = new Set();
    const books = [...byTitle, ...byAuthor.filter((b) => authorMatches(b, q))].filter((b) => b && b.id && !seen.has(b.id) && seen.add(b.id));
    // the API's language parameter is applied server-side where supported; filter again to be safe
    const items = books.map(parseBook).filter((i) => i && (!LANG_NAME[opts?.lang] || !i.language || i.language === opts.lang));
    return U.result(items, { page: p, hasMore: byTitle.length >= LIMIT });
  },

  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    const params = { format: 'json', extended: '1', limit: String(LIMIT), offset: String((p - 1) * LIMIT) };
    if (browseId === 'german') params.language = 'German';
    else if (LANG_NAME[opts?.lang]) params.language = LANG_NAME[opts.lang];
    if (browseId === 'recent') { params.since = String(Math.floor(Date.now() / 1000) - 120 * 86400); }
    else if (GENRES[browseId]) params.genre = GENRES[browseId];
    const books = booksOf(await net.jsonLenient(API + '?' + new URLSearchParams(params)));
    const want = params.language === 'German' ? 'de' : params.language === 'English' ? 'en' : null;
    const items = books.map(parseBook).filter((i) => i && (!want || !i.language || i.language === want));
    return U.result(items, { page: p, hasMore: books.length >= LIMIT, note: browseId === 'german' && !items.length && books.length ? 'LibriVox lieferte keine deutschen Titel. Bitte nach Titel oder Autor suchen (z. B. „Goethe“).' : null });
  },
};

function booksOf(json) { return Array.isArray(json?.books) ? json.books : []; }
function authorMatches(b, q) { const last = q.split(/\s+/).pop().toLowerCase(); return (b.authors || []).some((a) => String(a.last_name || '').toLowerCase().includes(last)); }

function iaIdOf(b) {
  const u = b.url_iarchive || b.url_zip_file || '';
  const m = /archive\.org\/(?:details|download|compress)\/([^/?#]+)/.exec(u);
  return m ? m[1] : null;
}

function parseBook(b) {
  if (!b || !b.id) return null;
  const rss = b.url_rss || null;
  const ia = iaIdOf(b);
  const formats = [];
  if (rss) formats.push({ type: 'audio-rss', url: rss, label: 'Podcast-Feed' });
  const authors = (b.authors || []).map((a) => [a.first_name, a.last_name].filter(Boolean).join(' ').trim()).filter(Boolean);
  const dates = (b.authors || []).map((a) => a.dob).filter(Boolean);
  const hours = b.totaltimesecs ? Math.round(Number(b.totaltimesecs) / 360) / 10 : null;
  return U.mkItem('librivox', b.id, {
    title: U.stripTags(b.title), author: authors.join(', '), year: b.copyright_year || null, language: U.langCode(b.language),
    subjects: (b.genres || []).map((g) => g.name).filter(Boolean), cover: ia ? `https://archive.org/services/img/${encodeURIComponent(ia)}` : null,
    description: U.stripTags(b.description), formats, readOnlineUrl: b.url_librivox || null, license: 'Public Domain', kind: 'audiobook',
    meta: { rss, totaltime: b.totaltime || null, hours, sections: Number(b.num_sections) || null, ia, textSource: b.url_text_source || null, authorBorn: dates[0] || null },
  });
}

module.exports = { ...source, parseBook };
