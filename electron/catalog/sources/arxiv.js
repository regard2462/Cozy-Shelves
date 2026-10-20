// arXiv – open-access preprints in physics, mathematics, computer science, economics … (Atom API).
'use strict';
const U = require('./util');
const X = require('../xml');

const API = 'https://export.arxiv.org/api/query';
const LIMIT = 20;
const CATS = { ai: 'cs.AI', ml: 'cs.LG', quantum: 'quant-ph', astro: 'astro-ph', math: 'math.HO', econ: 'econ.GN', physics: 'physics.hist-ph', bio: 'q-bio', stat: 'stat.ML', cs: 'cs.CL' };

const source = {
  id: 'arxiv', name: 'arXiv', icon: '🔬', kind: 'academic', lang: ['en'], canSearch: true,
  description: { de: 'Wissenschaftliche Preprints (Physik, Mathematik, Informatik, KI, Ökonomie) als PDF, kostenlos und aktuell.', en: 'Scientific preprints (physics, mathematics, computer science, AI, economics) as PDF – free and current.' },
  chips: [
    { id: 'ai', label: { de: 'Künstliche Intelligenz', en: 'Artificial intelligence' } },
    { id: 'ml', label: { de: 'Maschinelles Lernen', en: 'Machine learning' } },
    { id: 'cs', label: { de: 'Sprache & Computer', en: 'Computation & language' } },
    { id: 'quantum', label: { de: 'Quantenphysik', en: 'Quantum physics' } },
    { id: 'astro', label: { de: 'Astrophysik', en: 'Astrophysics' } },
    { id: 'math', label: { de: 'Mathematik (allg.)', en: 'Mathematics (general)' } },
    { id: 'econ', label: { de: 'Ökonomie', en: 'Economics' } },
    { id: 'physics', label: { de: 'Physikgeschichte', en: 'History of physics' } },
    { id: 'bio', label: { de: 'Biologie', en: 'Biology' } },
  ],

  async search(query, opts, { net }) {
    const p = U.page(opts);
    const q = U.norm(query).replace(/[":]/g, ' ');
    const params = new URLSearchParams({ search_query: `all:${q}`, start: String((p - 1) * LIMIT), max_results: String(LIMIT), sortBy: 'relevance', sortOrder: 'descending' });
    const r = await net.text(`${API}?${params}`, { xml: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseFeed(r.text, p);
  },
  async browse(browseId, opts, { net }) {
    const p = U.page(opts);
    const cat = CATS[browseId] || CATS.ai;
    const params = new URLSearchParams({ search_query: `cat:${cat}`, start: String((p - 1) * LIMIT), max_results: String(LIMIT), sortBy: 'submittedDate', sortOrder: 'descending' });
    const r = await net.text(`${API}?${params}`, { xml: true });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseFeed(r.text, p);
  },
};

function parseFeed(xml, p = 1) {
  const root = X.parseXml(xml);
  if (!root || root.local !== 'feed') throw new Error('arXiv: kein Atom-Feed');
  const total = parseInt(X.childText(root, 'totalResults'), 10);
  const items = X.children(root, 'entry').map(parseEntry).filter(Boolean);
  return U.result(items, { total: Number.isFinite(total) ? total : items.length, page: p, hasMore: Number.isFinite(total) ? p * LIMIT < total : items.length >= LIMIT });
}

function parseEntry(e) {
  const idUrl = X.childText(e, 'id');
  const m = /abs\/(.+?)(v\d+)?$/.exec(idUrl);
  if (!m) return null;
  const id = m[1];
  const authors = X.children(e, 'author').map((a) => X.childText(a, 'name')).filter(Boolean);
  const cats = X.children(e, 'category').map((c) => X.attr(c, 'term')).filter(Boolean);
  const pdf = X.children(e, 'link').find((l) => X.attr(l, 'title') === 'pdf' || /pdf/.test(X.attr(l, 'type') || ''));
  const published = X.childText(e, 'published');
  const journal = X.children(e).find((c) => c.local === 'journal_ref');
  const doi = X.children(e).find((c) => c.local === 'doi');
  return U.mkItem('arxiv', id, {
    title: X.childText(e, 'title').replace(/\s+/g, ' '), author: authors.slice(0, 6).join(', ') + (authors.length > 6 ? ' et al.' : ''), year: published ? published.slice(0, 4) : null, language: 'en',
    subjects: cats, cover: null, description: X.childText(e, 'summary').replace(/\s+/g, ' '),
    formats: [{ type: 'pdf', url: pdf ? X.attr(pdf, 'href').replace(/^http:/, 'https:').replace(/v\d+$/, '') : `https://arxiv.org/pdf/${id}`, label: 'PDF' }],
    readOnlineUrl: `https://arxiv.org/abs/${id}`, license: 'arXiv (frei zugänglich)', kind: 'paper',
    // readable in-app: newer papers have a full HTML rendering, older ones at least the abstract page
    canRead: true,
    meta: {
      arxivId: id, published, journal: journal ? X.text(journal).trim() : null, doi: doi ? X.text(doi).trim() : null, primary: cats[0] || null,
      readAlts: [`https://arxiv.org/html/${id}v1`, `https://arxiv.org/abs/${id}`],
    },
  });
}

module.exports = { ...source, parseFeed, parseEntry };
