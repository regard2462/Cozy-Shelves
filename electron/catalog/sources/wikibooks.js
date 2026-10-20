// Wikibooks (de/en) – free textbooks; books consist of a main page plus chapter subpages ("Buch/ Kapitel").
'use strict';
const U = require('./util');
const MW = require('./mediawiki');

const HOSTS = { de: 'de.wikibooks.org', en: 'en.wikibooks.org' };
const langOf = (l) => (l === 'en' ? 'en' : 'de');
const CATS = {
  de: { featured: 'Kategorie:Buch des Monats', complete: 'Kategorie:Fertiges Buch', math: 'Kategorie:Mathematik', it: 'Kategorie:Informatik', languages: 'Kategorie:Sprachen', history: 'Kategorie:Geschichte', science: 'Kategorie:Naturwissenschaften', cooking: 'Kategorie:Kochbuch' },
  en: { featured: 'Category:Featured books', complete: 'Category:Completed books', math: 'Category:Mathematics', it: 'Category:Computing', languages: 'Category:Languages', history: 'Category:History', science: 'Category:Science', cooking: 'Category:Cookbook' },
};
const SKIP = /^(Wikibooks|Hilfe|Help|Diskussion|Talk|Regal|Shelf|Kategorie|Category|Vorlage|Template|Benutzer|User|Datei|File|MediaWiki|Modul|Module|Spezial|Special|Wikijunior:|Cookbook:|Kochbuch:)/i;

const source = {
  id: 'wikibooks', name: 'Wikibooks', icon: '📗', kind: 'wiki', lang: ['de', 'en'], canSearch: true,
  description: { de: 'Freie Lehr- und Sachbücher von Mathematik bis Kochen. Kapitel werden zu einem Buch zusammengefügt.', en: 'Free textbooks and manuals – from mathematics to cooking. Chapters are stitched into one book.' },
  chips: [
    { id: 'featured', label: { de: 'Buch des Monats', en: 'Featured books' } },
    { id: 'complete', label: { de: 'Fertige Bücher', en: 'Completed books' } },
    { id: 'random', label: { de: 'Zufall', en: 'Random' } },
    { id: 'math', label: { de: 'Mathematik', en: 'Mathematics' } },
    { id: 'it', label: { de: 'Informatik', en: 'Computing' } },
    { id: 'languages', label: { de: 'Sprachen', en: 'Languages' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'science', label: { de: 'Naturwissenschaft', en: 'Science' } },
    { id: 'cooking', label: { de: 'Kochbuch', en: 'Cookbook' } },
  ],

  async search(query, opts, { net }) {
    const lang = langOf(opts?.lang), host = HOSTS[lang];
    const p = U.page(opts);
    const r = await MW.search(net, host, U.norm(query), { limit: 30, offset: (p - 1) * 30 });
    const hits = collapseToBooks(r.hits);
    const info = await MW.enrich(net, host, hits.map((h) => h.title));
    return U.result(hits.map((h) => toItem(h, lang, info[h.title])), { total: r.total, page: p, hasMore: r.hasMore });
  },

  async browse(browseId, opts, { net }) {
    const lang = langOf(opts?.lang), host = HOSTS[lang];
    const p = U.page(opts);
    if (browseId === 'random') {
      const hits = collapseToBooks((await MW.random(net, host, 24)).hits);
      const info = await MW.enrich(net, host, hits.map((h) => h.title));
      return U.result(hits.map((h) => toItem(h, lang, info[h.title])), { page: p, hasMore: true });
    }
    const cat = CATS[lang][browseId] || CATS[lang].featured;
    const r = await MW.categoryMembers(net, host, cat, { limit: 24, cont: opts?.cont || null });
    const hits = collapseToBooks(r.hits);
    const info = await MW.enrich(net, host, hits.map((h) => h.title));
    return { ...U.result(hits.map((h) => toItem(h, lang, info[h.title])), { page: p, hasMore: !!r.cont }), cont: r.cont };
  },
};

/** Chapter hits ("Buch/ Kapitel") are folded into their book; namespace pages dropped. */
function collapseToBooks(hits) {
  const out = [], seen = new Set();
  for (const h of hits) {
    if (SKIP.test(h.title)) continue;
    const root = MW.rootTitle(h.title);
    if (seen.has(root)) continue;
    seen.add(root);
    out.push({ ...h, title: root, chapterHit: root !== h.title ? h.title : null });
  }
  return out;
}

function toItem(h, lang, info) {
  const host = HOSTS[lang];
  const url = MW.pageUrl(host, h.title);
  return U.mkItem('wikibooks', `${lang}:${h.title}`, {
    title: h.title, author: lang === 'de' ? 'Wikibooks-Autoren' : 'Wikibooks contributors', language: lang, cover: info?.thumbnail || null,
    description: info?.extract || h.snippet || '', formats: [{ type: 'epub', url: 'build://epub', label: lang === 'de' ? 'EPUB (aus allen Kapiteln)' : 'EPUB (all chapters)' }, { type: 'html', url, label: 'HTML' }],
    readOnlineUrl: url, license: 'CC BY-SA', canRead: true, kind: 'wiki',
    meta: { wiki: 'wikibooks', host, lang, title: h.title, pageid: h.pageid || null, chapterHit: h.chapterHit || null, multiPage: true },
  });
}

module.exports = { ...source, toItem, collapseToBooks, HOSTS };
