// Zeno.org – large German full-text library (literature, philosophy, history, lexica). HTML site;
// the search result page is parsed defensively and texts are read through the generic web reader.
'use strict';
const U = require('./util');
const C = require('../../feeds/common');

// zeno.org has no TLS listener (port 443 times out) – plain http is the only working scheme.
// net.js additionally downgrades https→http once per host, so old bookmarks keep working.
const SITE = 'http://www.zeno.org';
const LIMIT = 20;
const PORTALS = [
  ['Literatur', SITE + '/Literatur', 'Romane, Dramen, Gedichte und Märchen aus der Zeno-Bibliothek der deutschen Literatur'],
  ['Philosophie', SITE + '/Philosophie', 'Philosophische Hauptwerke von Platon bis Nietzsche im Volltext'],
  ['Geschichte', SITE + '/Geschichte', 'Geschichtsquellen und Darstellungen'],
  ['Märchen', SITE + '/Märchen', 'Märchen aus aller Welt'],
  ['Naturwissenschaften', SITE + '/Naturwissenschaften', 'Klassiker der Naturwissenschaft'],
  ['Kulturgeschichte', SITE + '/Kulturgeschichte', 'Kulturgeschichte'],
  ['Musik', SITE + '/Musik', 'Musikgeschichte und Komponisten'],
];

const source = {
  id: 'zeno', name: 'Zeno.org', icon: '🏺', kind: 'books', lang: ['de'], canSearch: true,
  description: { de: 'Die große deutsche Volltextbibliothek für Literatur, Philosophie, Geschichte und Lexika, online lesbar.', en: 'The large German full-text library: literature, philosophy, history, lexica – readable online.' },
  chips: PORTALS.map(([name]) => ({ id: name.toLowerCase(), label: { de: name, en: name } })),

  async search(query, opts, { net }) {
    const p = U.page(opts);
    const q = U.norm(query);
    const url = `${SITE}/Zeno/0/Suche?q=${encodeURIComponent(q)}&k=Bibliothek${p > 1 ? '&s=' + ((p - 1) * LIMIT) : ''}`;
    const r = await net.text(url, { timeout: 30000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = parseSearchHtml(r.text, url);
    return U.result(items, { page: p, hasMore: items.length >= LIMIT });
  },

  async browse(browseId) {
    const one = PORTALS.find(([name]) => name.toLowerCase() === browseId);
    const list = one ? [one] : PORTALS;
    const items = list.map(([name, url, desc]) => toItem({ title: name, url, author: 'Zeno.org', description: desc, index: true }));
    return U.result(items, { page: 1, hasMore: false, note: 'Zeno.org hat keine Themenlisten-API. Die Portalseiten werden als Sammelband gelesen, die Suche findet einzelne Texte.' });
  },
};

function toItem({ title, url, author, description, index }) {
  return U.mkItem('zeno', url.replace(/^https?:\/\/[^/]+\//, ''), {
    title, author, language: 'de', description, formats: [{ type: 'epub', url: 'build://epub', label: 'EPUB (aus den Seiten erzeugt)' }, { type: 'html', url, label: 'HTML' }],
    readOnlineUrl: url, license: 'Gemeinfrei', canRead: true, kind: 'web', meta: { web: true, url, follow: true, index: !!index, site: 'zeno.org' },
  });
}

/** Result list: links into the library (paths like /Literatur/M/Autor/Werk/Kapitel). */
function parseSearchHtml(html, baseUrl) {
  const doc = C.parseHtml(html);
  const out = [], seen = new Set();
  const hits = [...doc.querySelectorAll('.zenoSRHit, .zenoSRHitTitle, li.zenoSRHit, .zenoSearchResult')];
  const candidates = hits.length ? hits : [...doc.querySelectorAll('a[href]')].map((a) => a.parentElement).filter(Boolean);
  for (const hit of candidates) {
    const a = hit.matches && hit.matches('a') ? hit : hit.querySelector('a[href]');
    if (!a) continue;
    const href = a.getAttribute('href') || '';
    if (!/^(\/|https?:\/\/(www\.)?zeno\.org\/)(Literatur|Philosophie|Geschichte|M%C3%A4rchen|Märchen|Naturwissenschaften|Kulturgeschichte|Musik|Kunstwerke|Bibliothek|Zeno)\//.test(href) || /\/Suche\?|\/Zeno\/0\//.test(href)) continue;
    const url = C.absolutize(href, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    // breadcrumb-like path → author / work
    let path; try { path = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean); } catch { path = []; }
    const author = path.length > 2 ? U.flipName(path[2].replace(/\+/g, ' ')) : null;
    const title = C.collapseWs(a.textContent) || path.slice(-1)[0]?.replace(/\+/g, ' ') || url;
    const snippet = C.collapseWs((hit.querySelector && hit.querySelector('.zenoSRHitText, .zenoSRHitSnippet, p'))?.textContent || '');
    out.push(toItem({ title, url, author: author && /^[A-ZÄÖÜ]/.test(author) ? author : null, description: snippet || path.slice(1, -1).map((s) => s.replace(/\+/g, ' ')).join(' › ') }));
    if (out.length >= LIMIT) break;
  }
  return out;
}

module.exports = { ...source, parseSearchHtml, toItem };
