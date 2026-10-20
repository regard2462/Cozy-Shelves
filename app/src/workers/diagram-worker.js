// Web worker of the chess diagrams (app/src/ui/chess/diagram):
//   { id, data (RGBA), width, height }                               → { id, rects }   boards on a page (night pages)
//   { id, type: 'recognize', data, width, height, hints, key, book,
//     templates?: { key, items } }                                    → { id, res } | { id, need: 'templates' } | { id, error }
// The recognition of a snip runs here, so that the reader stays responsive; the templates of this computer are drawn
// in the page (they need fonts and a canvas) and sent once.
import { findBoardsInPixels } from '../ui/chess/diagram/find-boards.js';
import { fromRGBA } from '../ui/chess/diagram/image.js';
import { recognize, makeTemplateSet } from '../ui/chess/diagram/recognize.js';

let templates = { key: null, tset: null };

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'recognize') {
    try {
      if (m.templates) templates = { key: m.templates.key, tset: makeTemplateSet(m.templates.items) };
      if (!templates.tset || templates.key !== m.key) { self.postMessage({ id: m.id, need: 'templates' }); return; }
      const tset = m.book?.length ? templates.tset.plus(m.book) : templates.tset;
      const res = recognize(fromRGBA(m.data, m.width, m.height), { templates: tset, hints: m.hints });
      self.postMessage({ id: m.id, res });
    } catch (err) {
      self.postMessage({ id: m.id, error: String(err?.stack || err) });
    }
    return;
  }
  const { id, data, width, height } = m;
  let rects = [];
  try { rects = findBoardsInPixels(data, width, height); } catch (err) { console.warn('[diagram-worker]', err); }
  self.postMessage({ id, rects });
};
