// Wikisource (de/en) – transcribed public-domain texts. Search + category browsing via the MediaWiki API,
// reading via the REST page HTML, EPUB via the WS Export tool (fallback: EPUB built in-app).
'use strict';
const U = require('./util');
const MW = require('./mediawiki');

const HOSTS = { de: 'de.wikisource.org', en: 'en.wikisource.org' };
const langOf = (l) => (l === 'en' ? 'en' : 'de');
const CATS = {
  de: { finished: { cat: 'Kategorie:Fertig', sort: 'timestamp', dir: 'desc' }, poems: { cat: 'Kategorie:Gedicht' }, fairy: { cat: 'Kategorie:Märchen' }, novels: { cat: 'Kategorie:Roman' }, novellas: { cat: 'Kategorie:Novelle' }, drama: { cat: 'Kategorie:Drama' }, letters: { cat: 'Kategorie:Brief' }, legends: { cat: 'Kategorie:Sage' } },
  en: { finished: { cat: 'Category:Featured texts' }, poems: { cat: 'Category:Poems' }, fairy: { cat: 'Category:Fairy tales' }, novels: { cat: 'Category:Novels' }, novellas: { cat: 'Category:Short stories' }, drama: { cat: 'Category:Plays' }, letters: { cat: 'Category:Letters' }, legends: { cat: 'Category:Legends' } },
};
const SKIP = /^(Wikisource|Hilfe|Help|Diskussion|Talk|Index|Seite|Page|Autor|Author|Kategorie|Category|Vorlage|Template|Portal|Benutzer|User|Datei|File|MediaWiki|Modul|Module|Spezial|Special):/i;

const source = {
  id: 'wikisource', name: 'Wikisource', icon: '🖋️', kind: 'wiki', lang: ['de', 'en'], canSearch: true,
  description: { de: 'Gemeinfreie Quellentexte, Gedichte, Märchen und Romane, transkribiert von Freiwilligen. Sofort lesbar, als EPUB ladbar.', en: 'Public-domain source texts, poems, tales and novels transcribed by volunteers. Read instantly or download as EPUB.' },
  chips: [
    { id: 'finished', label: { de: 'Zuletzt fertiggestellt', en: 'Featured texts' } },
    { id: 'random', label: { de: 'Zufällige Texte', en: 'Random texts' } },
    { id: 'poems', label: { de: 'Gedichte', en: 'Poems' } },
    { id: 'fairy', label: { de: 'Märchen', en: 'Fairy tales' } },
    { id: 'novels', label: { de: 'Romane', en: 'Novels' } },
    { id: 'novellas', label: { de: 'Novellen', en: 'Short stories' } },
    { id: 'drama', label: { de: 'Dramen', en: 'Plays' } },
    { id: 'letters', label: { de: 'Briefe', en: 'Letters' } },
    { id: 'legends', label: { de: 'Sagen', en: 'Legends' } },
  ],

  async search(query, opts, { net }) {
    const lang = langOf(opts?.lang), host = HOSTS[lang];
    const p = U.page(opts);
    const r = await MW.search(net, host, U.norm(query), { limit: 20, offset: (p - 1) * 20 });
    const hits = r.hits.filter((h) => !SKIP.test(h.title));
    const info = await MW.enrich(net, host, hits.map((h) => h.title));
    return U.result(hits.map((h) => toItem(h, lang, info[h.title])), { total: r.total, page: p, hasMore: r.hasMore });
  },

  async browse(browseId, opts, { net }) {
    const lang = langOf(opts?.lang), host = HOSTS[lang];
    const p = U.page(opts);
    let hits, hasMore = false, total = null;
    if (browseId === 'random') { hits = (await MW.random(net, host, 20)).hits.filter((h) => !SKIP.test(h.title)); hasMore = true; }
    else {
      const spec = CATS[lang][browseId] || CATS[lang].finished;
      // categories are paged with a continue token; we keep it in the options round-trip (opts.cont)
      const r = await MW.categoryMembers(net, host, spec.cat, { limit: 20, cont: opts?.cont || null, sort: spec.sort || 'sortkey', dir: spec.dir || 'asc' });
      hits = r.hits.filter((h) => !SKIP.test(h.title)); hasMore = !!r.cont;
      const info = await MW.enrich(net, host, hits.map((h) => h.title));
      return { ...U.result(hits.map((h) => toItem(h, lang, info[h.title])), { total, page: p, hasMore }), cont: r.cont };
    }
    const info = await MW.enrich(net, host, hits.map((h) => h.title));
    return U.result(hits.map((h) => toItem(h, lang, info[h.title])), { total, page: p, hasMore });
  },
};

function toItem(h, lang, info) {
  const host = HOSTS[lang];
  const title = h.title;
  const base = MW.rootTitle(title);
  const isChapter = base !== title;
  const url = MW.pageUrl(host, title);
  const wsExport = `https://ws-export.wmcloud.org/?format=epub&lang=${lang}&page=${encodeURIComponent(title.replace(/ /g, '_'))}`;
  return U.mkItem('wikisource', `${lang}:${title}`, {
    title: isChapter ? title.replace('/', ' · ') : title, author: null, language: lang, subjects: [], cover: info?.thumbnail || null,
    description: info?.extract || h.snippet || '', formats: [{ type: 'epub', url: wsExport, label: 'EPUB (WS Export)', fallback: 'build' }, { type: 'html', url, label: 'HTML' }],
    readOnlineUrl: url, license: lang === 'de' ? 'Gemeinfrei / CC BY-SA' : 'Public Domain / CC BY-SA', canRead: true, kind: 'wiki',
    meta: { wiki: 'wikisource', host, lang, title, pageid: h.pageid || null, words: h.wordcount || null },
  });
}

module.exports = { ...source, toItem, HOSTS };
