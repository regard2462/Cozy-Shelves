// Wikipedia (de/en) via the Wikimedia REST API: featured content, search, page HTML (sanitized), summary, random.
const path = require('path');
const C = require('./common');

const LANGS = new Set(['de', 'en']);
const langOf = (l) => (LANGS.has(String(l || '').toLowerCase()) ? String(l).toLowerCase() : 'de');
const PAGE_TTL = 6 * 60 * 60 * 1000;
const FEATURED_TTL = 60 * 60 * 1000;
const HEADERS = { 'Api-User-Agent': C.WIKI_UA };
const opts = (extra = {}) => ({ ua: C.WIKI_UA, headers: { ...HEADERS, ...extra }, timeout: 20000 });

const NS_SKIP = /^(Datei|File|Bild|Image|Kategorie|Category|Spezial|Special|Wikipedia|Hilfe|Help|Vorlage|Template|Diskussion|Talk|Portal|Benutzer|User|Modul|Module|MediaWiki|Wikt|Wiktionary|Commons|s|q|d|b|n|v|m|wikt|wikisource|wikiquote):/i;
const FILE_NS = /^(Datei|File|Bild|Image):/i;
const REMOVE_SELECTORS = [
  'script', 'style', 'link', 'meta', 'noscript', '.mw-editsection', '.navbox', '.vertical-navbox', '.navbox-styles', '.metadata', '.ambox', '.mbox-small', '.noprint', '.sistersitebox', '.side-box',
  '.mw-empty-elt', '.catlinks', '.toc', '#toc', '.mw-authority-control', '.NavFrame', '.BoxenVerschmelzen', '.mw-cite-backlink', '.mw-kartographer-container', '.mw-kartographer-maplink', '.mw-indicators',
  '.printfooter', '.shortdescription', '.mw-jump-link', '.hidden', '.error', '.mw-ext-cite-error', '.mw-hidden-catlinks', '.noexcerpt.navigation-not-searchable', 'table.sistersitebox', '.mw-references-wrap + .mw-empty-elt',
  '.mw-inline-video', 'audio', 'video', '.mediaContainer', '#Vorlage_Gesprochene_Version', '.gesprochene-version', '.ext-discussiontools-init-section',
];
const REMOVE_SECTION_TITLES = /^(Weblinks|External links|Navigation|Weiterführende Links)$/i;

function wikiTitleFromHref(href, lang) {
  if (!href) return null;
  let t = null;
  if (href.startsWith('./')) t = href.slice(2);
  else if (href.startsWith('/wiki/')) t = href.slice(6);
  else {
    const m = /^(?:https?:)?\/\/([a-z-]+)\.(?:m\.)?wikipedia\.org\/wiki\/(.+)$/i.exec(href);
    if (m && m[1].toLowerCase() === lang) t = m[2];
  }
  if (t == null) return null;
  let frag = null;
  const h = t.indexOf('#');
  if (h >= 0) { frag = t.slice(h + 1); t = t.slice(0, h); }
  try { t = decodeURIComponent(t); } catch {}
  try { if (frag) frag = decodeURIComponent(frag); } catch {}
  t = t.replace(/_/g, ' ').trim();
  return { title: t, frag };
}

/**
 * Sanitize Parsoid / action-API HTML for offline display in the app.
 * Links become <a data-wiki="Title" data-frag="...">, external links keep href + data-ext.
 * Returns { html, text, toc:[{id,text,level}], images:[...], firstImage }.
 */
function sanitizeWikiHtml(html, lang, title) {
  lang = langOf(lang);
  const doc = C.parseHtml(html);
  const root = doc.body;
  for (const sel of REMOVE_SELECTORS) { try { for (const el of root.querySelectorAll(sel)) el.remove(); } catch {} }
  // sections we don't want (external links)
  for (const sec of [...root.querySelectorAll('section')]) {
    const h = sec.querySelector(':scope > h2, :scope > h3, :scope > .mw-heading > h2');
    if (h && REMOVE_SECTION_TITLES.test(C.collapseWs(h.textContent))) sec.remove();
  }
  // classic (action API) output: headings followed by content until next heading – remove Weblinks blocks
  for (const h of [...root.querySelectorAll('h2')]) {
    if (!h.parentNode || !REMOVE_SECTION_TITLES.test(C.collapseWs(h.textContent))) continue;
    let n = h.nextSibling; const del = [h];
    while (n && !(n.nodeType === 1 && /^H2$/.test(n.tagName))) { del.push(n); n = n.nextSibling; }
    for (const d of del) d.remove?.();
  }
  // links
  for (const a of [...root.querySelectorAll('a')]) {
    const href = a.getAttribute('href') || '';
    const cls = a.getAttribute('class') || '';
    for (const attr of [...a.attributes]) if (!['href', 'title', 'class'].includes(attr.name)) a.removeAttribute(attr.name);
    if (href.startsWith('#')) { a.setAttribute('data-anchor', href.slice(1)); a.removeAttribute('href'); continue; }
    const t = wikiTitleFromHref(href, lang);
    if (t) {
      if (FILE_NS.test(t.title)) { a.removeAttribute('href'); a.setAttribute('data-file', t.title); continue; }
      if (NS_SKIP.test(t.title) || /\bnew\b/.test(cls) || !t.title) { unwrapEl(a); continue; }
      a.removeAttribute('href');
      if (t.frag && title && t.title.replace(/_/g, ' ') === String(title).replace(/_/g, ' ')) { a.setAttribute('data-anchor', t.frag); continue; }
      a.setAttribute('data-wiki', t.title);
      if (t.frag) a.setAttribute('data-frag', t.frag);
      if (!a.getAttribute('title')) a.setAttribute('title', t.title);
      continue;
    }
    const abs = C.absolutize(href);
    if (abs) { a.setAttribute('href', abs); a.setAttribute('data-ext', '1'); }
    else unwrapEl(a);
  }
  function unwrapEl(el) { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); }
  // images: protocol-relative → https, drop srcset
  for (const img of root.querySelectorAll('img')) {
    const src = C.absolutize(img.getAttribute('src'), 'https://' + lang + '.wikipedia.org/');
    if (!src) { img.remove(); continue; }
    img.setAttribute('src', src);
    img.removeAttribute('srcset');
    const w = parseInt(img.getAttribute('width') || '0', 10);
    if (w && w <= 2) img.remove();
  }
  // headings: ensure ids for the TOC (Parsoid puts ids on the heading, MW ≥1.41 on the .mw-heading wrapper or the span)
  const toc = []; let n = 0;
  for (const h of root.querySelectorAll('h2, h3')) {
    const text = C.collapseWs(h.textContent);
    if (!text) continue;
    let id = h.getAttribute('id') || h.querySelector('.mw-headline')?.getAttribute('id') || h.parentElement?.getAttribute('id');
    if (!id) id = 'wsec-' + (++n);
    h.setAttribute('id', id);
    toc.push({ id, text, level: h.tagName === 'H2' ? 2 : 3 });
  }
  const s = C.sanitizeHtml(root.innerHTML, { baseUrl: 'https://' + lang + '.wikipedia.org/', keepClasses: true, keepIds: true, keepStyle: true, keepData: ['data-wiki', 'data-frag', 'data-ext', 'data-anchor', 'data-file'], allowedTags: ['audio'] });
  return { html: s.html, text: s.text, toc, images: s.images, firstImage: s.firstImage, title };
}

function normSummary(j, lang) {
  if (!j) return null;
  return { title: j.title, displayTitle: C.htmlToText(j.displaytitle || j.title), description: j.description || null, extract: j.extract || '', extractHtml: j.extract_html || null, thumbnail: j.thumbnail?.source ? { url: C.absolutize(j.thumbnail.source), width: j.thumbnail.width, height: j.thumbnail.height } : null, image: j.originalimage?.source ? C.absolutize(j.originalimage.source) : null, url: j.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(j.title || '').replace(/ /g, '_'))}`, lang, timestamp: j.timestamp || null, type: j.type || 'standard' };
}

/** Normalize the REST feed/featured response. */
function parseFeatured(j, lang, date) {
  lang = langOf(lang);
  const out = { lang, date, tfa: normSummary(j.tfa, lang), image: null, mostread: [], onthisday: [], news: [] };
  if (j.image) {
    out.image = { title: j.image.title, thumbnail: C.absolutize(j.image.thumbnail?.source), image: C.absolutize(j.image.image?.source), description: C.htmlToText(j.image.description?.html || j.image.description?.text || ''), artist: C.htmlToText(j.image.artist?.html || j.image.artist?.text || ''), credit: C.htmlToText(j.image.credit?.text || ''), license: j.image.license?.type || null, url: j.image.file_page || null };
  }
  out.mostread = (j.mostread?.articles || []).filter((a) => a.title && !/^(Spezial|Special|Wikipedia|Hauptseite|Main Page):?/i.test(a.title) && a.title !== 'Wikipedia:Hauptseite' && a.title !== 'Main_Page').slice(0, 12).map((a) => ({ ...normSummary(a, lang), views: a.views, rank: a.rank }));
  out.onthisday = (j.onthisday || []).slice(0, 14).map((e) => ({ year: e.year, text: e.text, pages: (e.pages || []).slice(0, 4).map((p) => normSummary(p, lang)) }));
  out.news = (j.news || []).slice(0, 8).map((n) => ({ story: C.htmlToText(n.story || ''), storyHtml: sanitizeStory(n.story || '', lang), pages: (n.links || []).slice(0, 4).map((p) => normSummary(p, lang)) }));
  return out;
}
function sanitizeStory(html, lang) { try { return sanitizeWikiHtml(html, lang).html; } catch { return C.htmlToText(html); } }

function parseSearch(j, lang) {
  return (j.pages || []).map((p) => ({ id: p.id, title: p.title, key: p.key, description: p.description || null, excerpt: C.htmlToText(p.excerpt || ''), thumbnail: p.thumbnail?.url ? C.absolutize(p.thumbnail.url) : null, lang }));
}

function register(ctx) {
  const { ipcMain, app } = ctx;
  const cache = new C.DiskCache(path.join(app.getPath('userData'), 'feeds-cache', 'wiki'), { memoryLimit: 20 });
  const enc = (t) => encodeURIComponent(String(t || '').trim().replace(/ /g, '_'));

  ipcMain.handle('wiki:featured', async (e, lang, date) => {
    lang = langOf(lang);
    const d = date ? new Date(date) : new Date();
    const ymd = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const key = `featured-${lang}-${ymd.replace(/\//g, '-')}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < FEATURED_TTL) return c.data;
    const j = await C.fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/feed/featured/${ymd}`, opts());
    const res = parseFeatured(j, lang, ymd.replace(/\//g, '-'));
    cache.set(key, res);
    return res;
  });

  ipcMain.handle('wiki:search', async (e, lang, q) => {
    lang = langOf(lang); q = String(q || '').trim();
    if (!q) return [];
    try {
      const j = await C.fetchJson(`https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=12`, opts());
      const r = parseSearch(j, lang);
      if (r.length) return r;
    } catch (err) { console.warn('[wiki] title search failed, trying opensearch', err.message); }
    const j = await C.fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&format=json&limit=12&namespace=0&search=${encodeURIComponent(q)}`, opts());
    return (j[1] || []).map((title, i) => ({ id: null, title, key: title.replace(/ /g, '_'), description: (j[2] || [])[i] || null, excerpt: '', thumbnail: null, lang }));
  });

  ipcMain.handle('wiki:page', async (e, lang, title) => {
    lang = langOf(lang); title = String(title || '').trim();
    if (!title) throw new Error('no title');
    const key = `page-${lang}-${C.shortId(title, 20)}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < PAGE_TTL) return { ...c.data, fromCache: true };
    let html = null, resolvedTitle = title, summary = null;
    try { summary = normSummary(await C.fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title)}?redirect=true`, opts()), lang); if (summary?.title) resolvedTitle = summary.title; } catch {}
    try {
      const r = await C.fetchText(`https://${lang}.wikipedia.org/api/rest_v1/page/html/${enc(resolvedTitle)}?redirect=true`, opts({ Accept: 'text/html' }));
      if (r.ok) html = r.text; else if (r.status !== 404) throw new Error('HTTP ' + r.status);
    } catch (err) { console.warn('[wiki] REST html failed, falling back to action API', err.message); }
    if (!html) {
      const j = await C.fetchJson(`https://${lang}.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=text|displaytitle&redirects=1&disabletoc=1&disableeditsection=1&page=${encodeURIComponent(resolvedTitle)}`, opts());
      if (j.error) throw new Error(j.error.info || 'page not found');
      html = j.parse?.text || '';
      resolvedTitle = j.parse?.title || resolvedTitle;
    }
    const s = sanitizeWikiHtml(html, lang, resolvedTitle);
    const res = { title: resolvedTitle, displayTitle: summary?.displayTitle || resolvedTitle, description: summary?.description || null, lang, html: s.html, toc: s.toc, textContent: s.text, image: summary?.image || summary?.thumbnail?.url || s.firstImage || null, url: summary?.url || `https://${lang}.wikipedia.org/wiki/${enc(resolvedTitle)}`, readingMinutes: C.readingMinutes(s.text) };
    cache.set(key, res);
    return res;
  });

  ipcMain.handle('wiki:summary', async (e, lang, title) => {
    lang = langOf(lang);
    const j = await C.fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title)}?redirect=true`, opts());
    return normSummary(j, lang);
  });

  // The summary of an article named by its Wikidata item (the world map knows the item of every country and city):
  // the item's sitelink gives the exact title in the wanted language; without one the given title is used.
  // ref: { wikidata: 'Q64', title: 'Berlin' }. Only the item id or the title leave the app.
  ipcMain.handle('wiki:summaryFor', async (e, lang, ref) => {
    lang = langOf(lang);
    const qid = /^Q\d{1,12}$/.test(String(ref?.wikidata || '')) ? String(ref.wikidata) : null;
    const fallback = String(ref?.title || '').trim().slice(0, 300);
    const key = `sumfor-${lang}-${qid || C.shortId(fallback, 20)}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < PAGE_TTL) return c.data;
    let title = null;
    if (qid) {
      try {
        // origin=*: the browser version (which bundles this file) may read the answer (CORS); the app ignores it
        const j = await C.fetchJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${qid}&sitefilter=${lang}wiki&origin=*`, opts());
        title = j?.entities?.[qid]?.sitelinks?.[lang + 'wiki']?.title || null;
      } catch (err) { console.warn('[wiki] wikidata sitelink failed', qid, err.message); }
    }
    title = title || fallback;
    if (!title) return null;
    try {
      const res = normSummary(await C.fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title)}?redirect=true`, opts()), lang);
      cache.set(key, res);
      return res;
    } catch (err) {
      if (c) return c.data;     // offline: the text from the last visit
      throw err;
    }
  });

  ipcMain.handle('wiki:random', async (e, lang) => {
    lang = langOf(lang);
    const j = await C.fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`, opts());
    return normSummary(j, lang);
  });
}

module.exports = { register, sanitizeWikiHtml, parseFeatured, parseSearch, normSummary, wikiTitleFromHref };
