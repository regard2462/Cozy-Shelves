// Registry of catalog sources (order = drawer order in the UI).
'use strict';
const SOURCES = [
  require('./gutenberg'),
  require('./standardebooks'),
  require('./gutenberg-de'),
  require('./wikisource'),
  require('./wikibooks'),
  require('./archive'),
  require('./openlibrary'),
  require('./oapen'),
  require('./librivox'),
  require('./arxiv'),
  require('./zeno'),
  require('./web'),
];
const byId = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

/** Public description of the sources for the renderer. */
function describe() {
  return SOURCES.map((s) => ({ id: s.id, name: s.name, icon: s.icon || '📚', description: s.description, lang: s.lang || [], kind: s.kind || 'books', canSearch: s.canSearch !== false, urlInput: !!s.urlInput, browse: (s.chips || []).map((b) => ({ id: b.id, label: b.label })) }));
}

module.exports = { SOURCES, byId, describe };
