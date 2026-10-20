// OAPEN Library / DOAB – peer-reviewed open-access academic books (many in German and English:
// politics, economics, history, philosophy …). DSpace REST API; OAPEN carries the PDFs (bitstreams),
// DOAB is used as a fallback catalogue with links to the publisher copies.
'use strict';
const U = require('./util');

const OAPEN = 'https://library.oapen.org';
const DOAB = 'https://directory.doabooks.org';
const LIMIT = 20;
const TOPICS = { economics: 'economics', politics: 'politics', history: 'history', philosophy: 'philosophy', sociology: 'sociology', literature: 'literature', law: 'law', education: 'education', religion: 'religion' };
const LANG_FILTER = { de: 'dc.language:German', en: 'dc.language:English' };

const source = {
  id: 'oapen', name: 'OAPEN / DOAB', icon: '🎓', kind: 'academic', lang: ['en', 'de'], canSearch: true,
  description: { de: 'Open-Access-Fachbücher aus Wissenschaftsverlagen (Politik, Wirtschaft, Geschichte, Philosophie …) als PDF.', en: 'Open-access scholarly books from academic publishers (politics, economics, history, philosophy …) as PDF.' },
  chips: [
    { id: 'recent', label: { de: 'Neu', en: 'Recent' } },
    { id: 'german', label: { de: 'Deutschsprachig', en: 'German-language' } },
    { id: 'economics', label: { de: 'Wirtschaft', en: 'Economics' } },
    { id: 'politics', label: { de: 'Politik', en: 'Politics' } },
    { id: 'history', label: { de: 'Geschichte', en: 'History' } },
    { id: 'philosophy', label: { de: 'Philosophie', en: 'Philosophy' } },
    { id: 'sociology', label: { de: 'Soziologie', en: 'Sociology' } },
    { id: 'literature', label: { de: 'Literaturwissenschaft', en: 'Literature' } },
    { id: 'law', label: { de: 'Recht', en: 'Law' } },
  ],

  async search(query, opts, deps) {
    const p = U.page(opts);
    const q = U.norm(query);
    return run(q, opts?.lang, p, deps);
  },
  async browse(browseId, opts, deps) {
    const p = U.page(opts);
    if (browseId === 'german') return run('*', 'de', p, deps);
    if (browseId === 'recent') return run('*', opts?.lang, p, deps);
    return run(TOPICS[browseId] || browseId, opts?.lang, p, deps);
  },
};

/** The hint above the DOAB fallback results: why OAPEN is missing, in words, never a raw request URL. */
function doabNote(err, hidden) {
  const msg = String(err?.message || err || '');
  const code = /HTTP (\d{3})/.exec(msg);
  const why = code ? `Serverfehler ${code[1]}` : /timeout|Zeitüberschreitung|TIMED_OUT/i.test(msg) ? 'keine Antwort' : 'nicht erreichbar';
  return `OAPEN antwortet gerade nicht (${why}). Die Treffer kommen aus dem DOAB-Verzeichnis.`
    + (hidden > 0 ? ` ${hidden} Titel ohne frei ladbare Datei sind ausgeblendet.` : '');
}

async function run(q, lang, p, { net }) {
  const offset = (p - 1) * LIMIT;
  const terms = [q && q !== '*' ? q : '*'];
  let items = [], hasMore = false, note = null;
  try {
    let arr = await oapenSearch(net, terms, lang, offset);
    if (!arr.length && LANG_FILTER[lang] && q !== '*') { arr = await oapenSearch(net, terms, null, offset); items = arr.map(parseDspaceItem).filter((i) => i && (!lang || i.language === lang || !i.language)); }
    else items = arr.map(parseDspaceItem).filter(Boolean);
    hasMore = arr.length >= LIMIT;
  } catch (e) {
    // DOAB fallback (catalogue with links to the publisher copy). The bitstreams have to be expanded
    // here too – without them every fallback card has neither a download nor a cover.
    const params = new URLSearchParams({ query: terms.join(' '), expand: 'metadata,bitstreams', limit: String(LIMIT), offset: String(offset) });
    const arr = await net.jsonLenient(`${DOAB}/rest/search?${params}`, { headers: { Accept: 'application/json' } });
    const all = (Array.isArray(arr) ? arr : []).map((it) => parseDspaceItem(it, 'doab')).filter(Boolean);
    items = all.filter((i) => i.formats.length);        // a card that can neither be read nor loaded is noise
    hasMore = all.length >= LIMIT;
    note = doabNote(e, all.length - items.length);
  }
  return U.result(items, { total: null, page: p, hasMore, note });
}

async function oapenSearch(net, terms, lang, offset) {
  const q = [terms.join(' ')].concat(LANG_FILTER[lang] ? ['AND', LANG_FILTER[lang]] : []).join(' ');
  const params = new URLSearchParams({ query: q, expand: 'metadata,bitstreams', limit: String(LIMIT), offset: String(offset) });
  const arr = await net.jsonLenient(`${OAPEN}/rest/search?${params}`, { headers: { Accept: 'application/json' }, timeout: 30000 });
  if (!Array.isArray(arr)) throw new Error('unexpected OAPEN response');
  return arr;
}

const md = (item, key) => (item.metadata || []).filter((m) => m && m.key === key).map((m) => String(m.value || '').trim()).filter(Boolean);
const mdFirst = (item, ...keys) => { for (const k of keys) { const v = md(item, k); if (v.length) return v[0]; } return null; };

/** Parse a DSpace item (OAPEN or DOAB) into a catalog item. */
function parseDspaceItem(it, origin = 'oapen') {
  if (!it || (!it.uuid && !it.id && !it.handle)) return null;
  const site = origin === 'doab' ? DOAB : OAPEN;
  const title = mdFirst(it, 'dc.title') || it.name;
  const authors = [...md(it, 'dc.contributor.author').map(U.flipName), ...md(it, 'dc.contributor.editor').map((e) => U.flipName(e) + ' (Hg.)')];
  const formats = [];
  for (const b of it.bitstreams || []) {
    if (!b || !/ORIGINAL/i.test(b.bundleName || 'ORIGINAL')) continue;
    const type = U.typeOf(b.mimeType || b.format || b.name);
    if (!type || type === 'html' || type === 'audio-rss') continue;
    const link = b.retrieveLink ? (b.retrieveLink.startsWith('http') ? b.retrieveLink : site + b.retrieveLink) : null;
    if (!link || formats.some((f) => f.type === type)) continue;
    formats.push({ type, url: link, label: type.toUpperCase(), size: Number(b.sizeBytes) || null });
  }
  let cover = null;
  const thumb = (it.bitstreams || []).find((b) => b && /THUMBNAIL/i.test(b.bundleName || ''));
  if (thumb && thumb.retrieveLink) cover = thumb.retrieveLink.startsWith('http') ? thumb.retrieveLink : site + thumb.retrieveLink;
  if (!formats.length) {
    const ext = md(it, 'dc.relation.uri').concat(md(it, 'oapen.relation.uri'), md(it, 'dc.identifier.url')).find((u) => /^https?:\/\/.+\.pdf(\?|$)/i.test(u));
    if (ext) formats.push({ type: 'pdf', url: ext, label: 'PDF (Verlag)' });
  }
  const handle = it.handle ? `${site}/handle/${it.handle}` : mdFirst(it, 'dc.identifier.uri');
  const publisher = mdFirst(it, 'dc.publisher', 'oapen.relation.isPublishedBy', 'publisher.name');
  const rights = mdFirst(it, 'dc.rights', 'oapen.rights', 'dc.rights.uri');
  return U.mkItem('oapen', it.uuid || it.id || it.handle, {
    title, author: authors.join(', '), year: (mdFirst(it, 'dc.date.issued', 'dc.date.available') || '').slice(0, 4), language: U.langCode(mdFirst(it, 'dc.language')),
    subjects: [...md(it, 'dc.subject.classification'), ...md(it, 'dc.subject.other')].flatMap((s) => s.split(/\s*[;,]\s*/)).map((s) => s.replace(/^bic Book Industry Communication::/i, '').replace(/^[A-Z]{1,4}\s+/, '')),
    cover, description: mdFirst(it, 'dc.description.abstract', 'dc.description'), formats, readOnlineUrl: handle, license: rights ? (/^(open access|oa)/i.test(rights) ? 'Open Access' : rights.slice(0, 70)) : 'Open Access',
    meta: { origin, publisher, isbn: mdFirst(it, 'dc.identifier.isbn', 'oapen.relation.isbn'), doi: mdFirst(it, 'oapen.identifier.doi', 'dc.identifier.doi') },
  });
}

module.exports = { ...source, parseDspaceItem };
