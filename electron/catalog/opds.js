// OPDS 1.x (Atom) catalog parser – a DOM-free port of the logic in app/vendor/foliate-js/opds.js.
// parseOpds(xml, baseUrl) → { title, subtitle, links, publications, navigation, next, search }
'use strict';
const X = require('./xml');

const REL = {
  ACQ: 'http://opds-spec.org/acquisition',
  COVER: ['http://opds-spec.org/image', 'http://opds-spec.org/cover', 'x-stanza-cover-image'],
  THUMB: ['http://opds-spec.org/image/thumbnail', 'http://opds-spec.org/thumbnail', 'x-stanza-cover-image-thumbnail'],
};

const abs = (href, base) => { if (!href) return null; try { return new URL(href, base || undefined).href; } catch { return href; } };

function getLink(el, base) {
  return {
    rel: (X.attr(el, 'rel') || '').split(/\s+/).filter(Boolean),
    href: abs(X.attr(el, 'href'), base),
    type: X.attr(el, 'type') || null,
    title: X.attr(el, 'title') || null,
    count: X.attr(el, 'thr:count') || X.attr(el, 'count') || null,
  };
}

function getContent(el) {
  if (!el) return null;
  const type = X.attr(el, 'type') || 'text';
  if (type === 'xhtml') return { type, value: X.innerXml(el) };
  return { type: /html/.test(type) ? 'html' : 'text', value: X.text(el).trim() };
}

function getPerson(el) { return { name: X.childText(el, 'name'), uri: X.childText(el, 'uri') || null }; }

/** An <entry> that carries acquisition links → publication object. */
function getPublication(entry, base) {
  const links = X.children(entry, 'link').map((l) => getLink(l, base));
  const byRel = (rels) => links.find((l) => l.rel.some((r) => rels.includes(r)));
  const content = getContent(X.child(entry, 'content')) || getContent(X.child(entry, 'summary'));
  const summary = getContent(X.child(entry, 'summary'));
  const dcFirst = (name) => { const c = X.children(entry).find((c) => c.local === name && /^(dc|dcterms):/.test(c.name)); return c ? X.text(c).trim() : ''; };
  return {
    id: X.childText(entry, 'id') || null,
    title: X.childText(entry, 'title'),
    authors: X.children(entry, 'author').map(getPerson),
    contributors: X.children(entry, 'contributor').map(getPerson),
    publisher: dcFirst('publisher') || null,
    published: dcFirst('issued') || dcFirst('date') || X.childText(entry, 'published') || null,
    updated: X.childText(entry, 'updated') || null,
    language: dcFirst('language') || null,
    identifier: dcFirst('identifier') || null,
    subjects: X.children(entry, 'category').map((c) => ({ name: X.attr(c, 'label') || X.attr(c, 'term'), code: X.attr(c, 'term'), scheme: X.attr(c, 'scheme') })).filter((s) => s.name),
    rights: X.childText(entry, 'rights') || '',
    summary: summary ? summary.value : (content && content.type === 'text' ? content.value : ''),
    content,
    links,
    acquisition: links.filter((l) => l.rel.some((r) => r.startsWith(REL.ACQ))),
    cover: byRel(REL.COVER)?.href || null,
    thumbnail: byRel(REL.THUMB)?.href || null,
  };
}

/** Parse an OPDS acquisition or navigation feed. */
function parseOpds(xml, baseUrl) {
  const root = X.parseXml(xml);
  if (!root || root.local !== 'feed') throw new Error('not an Atom feed');
  const base = baseUrl || null;
  const links = X.children(root, 'link').map((l) => getLink(l, base));
  const publications = [], navigation = [];
  for (const entry of X.children(root, 'entry')) {
    const elinks = X.children(entry, 'link').map((l) => getLink(l, base));
    const isPub = elinks.some((l) => l.rel.some((r) => r.startsWith(REL.ACQ) || r === 'preview'));
    if (isPub) publications.push(getPublication(entry, base));
    else {
      const nav = elinks.find((l) => /atom\+xml|opds\+json/.test(l.type || '')) || elinks[0] || {};
      const summary = getContent(X.child(entry, 'summary')) || getContent(X.child(entry, 'content'));
      navigation.push({ title: X.childText(entry, 'title'), href: nav.href || null, type: nav.type || null, summary: summary ? summary.value : '' });
    }
  }
  const rel = (r) => links.find((l) => l.rel.includes(r))?.href || null;
  return {
    title: X.childText(root, 'title'), subtitle: X.childText(root, 'subtitle') || null,
    links, publications, navigation,
    next: rel('next'), self: rel('self'), start: rel('start'), search: links.find((l) => l.rel.includes('search'))?.href || null,
  };
}

module.exports = { parseOpds, getPublication, REL };
