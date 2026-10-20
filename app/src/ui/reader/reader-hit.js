// Hits of the full-text search in the reader. Opened from the search panel (app/src/ui/search/search-panel.js) with
// params.hit = { q, u, kind, loc: { p } | { s, o, len }, page }, the reader goes to the page of the hit and marks the
// words of the query on every page it shows, until the ✕ of the chip below the top bar removes the marks. A PDF page
// is searched in its text layer, a section of a flowing book in its document; both are read with the rules of the
// index (dom-text.js, textnorm.js), so the hit is found again. While the reader only peeks at a hit, the reading
// position of the book stays where it was; it moves as soon as a page is turned.
import { h } from '../../core/dom.js';
import { bus } from '../../core/bus.js';
import { isPanelOpen } from '../panels.js';
import { domPieces } from '../../search/dom-text.js';
import { cleanText, pieceAt, parseQuery, findMatches } from '../../../../electron/search/textnorm.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const NEAR_SECTIONS = 3;   // a chunk may sit a section further when the reader cut the book differently
/** the magnifier of the reader's button "In allen Büchern suchen" */
export const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>';

/** Marks of the hits: a translucent warm fill the letters show through, the hit itself framed as well. */
function drawMark(rects, { night = false, current = false } = {}) {
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'rd-fts-mark');
  for (const { left, top, width, height } of rects) {
    if (!width || !height) continue;
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', left - 1); r.setAttribute('y', top); r.setAttribute('width', width + 2); r.setAttribute('height', height);
    r.setAttribute('rx', 2);
    r.setAttribute('fill', night ? '#e3a200' : '#ffb800');
    r.setAttribute('fill-opacity', night ? '0.38' : '0.36');
    if (current) { r.setAttribute('stroke', night ? '#ffd27a' : '#d0620c'); r.setAttribute('stroke-width', '1.6'); r.setAttribute('stroke-opacity', '0.95'); }
    g.append(r);
  }
  return g;
}

export function createSearchHit(R) {
  const { T } = R;
  let hit = R.params?.hit || null;
  let query = hit ? parseQuery(hit.q) : null;
  let peek = !!hit;          // the book's reading position is kept while the reader only shows the hit
  let settling = !!hit;      // the reader is still on its way to the hit
  let landing = null;        // the page (PDF) or location (flowing book) the hit was shown on
  let target = null;         // { index, raw } of the hit in a flowing book (it gets the frame)
  let destroyed = false;
  const drawn = new Map();   // doc → keys of its marks
  const watchers = new Map(); // doc → MutationObserver of a PDF text layer

  const chipText = h('span.rd-fts-q');
  const el = h('div.rd-fts-chip.hidden',
    h('button.rd-fts-back', { title: T('Zurück zur Volltextsuche', 'Back to the full-text search'), onclick: () => back() }, '‹ ', T('Suche', 'Search')),
    chipText,
    h('button.rd-fts-clear', { title: T('Markierungen entfernen', 'Remove the marks'), 'aria-label': T('Markierungen entfernen', 'Remove the marks'), onclick: () => clear() }, '✕'));
  const showChip = () => { el.classList.toggle('hidden', !query); chipText.textContent = query ? `„${query.text}“` : ''; };
  showChip();

  const night = () => R.settings?.theme === 'night';
  const contents = () => R.view?.renderer?.getContents?.() || [];
  const indexOf = (doc) => (R.isFixed ? R.docIndex.get(doc) : contents().find((c) => c.doc === doc)?.index);

  /** The marks of the query in `root`: [{ range, raw, exact }] (raw: position in the raw text of domPieces). */
  function matchesIn(root, doc) {
    if (!query || !root) return [];
    const dt = domPieces(root);
    const cl = cleanText(dt.pieces, { map: true });
    const out = [];
    for (const m of findMatches(cl.text, query)) {
      const [ps, os] = pieceAt(cl.starts, cl.src[m.a]);
      const [pe, oe] = pieceAt(cl.starts, cl.src[m.b - 1]);
      const a = dt.pieces[ps], b = dt.pieces[pe];
      if (!a?.node || !b?.node) continue;
      try {
        const r = doc.createRange();
        r.setStart(a.node, os); r.setEnd(b.node, Math.min(b.node.data.length, oe + 1));
        out.push({ range: r, raw: cl.src[m.a], exact: m.exact });
      } catch { /* the document changed meanwhile */ }
    }
    return out;
  }

  function undraw(doc) {
    const keys = drawn.get(doc);
    if (!keys) return;
    const ov = R.overlayFor(doc);
    for (const k of keys) { try { ov?.remove(k); } catch {} }
    drawn.delete(doc);
  }

  function draw(doc) {
    if (destroyed || !doc) return;
    undraw(doc);
    if (!query) return;
    const index = indexOf(doc);
    const root = R.isFixed ? doc.querySelector('.textLayer') : (doc.body || doc.documentElement);
    const ov = R.overlayFor(doc, R.isFixed);
    if (!root || !ov) return;
    const marks = matchesIn(root, doc);
    // the hit itself: the first mark on the page of a PDF hit, the chosen place in a flowing book
    let cur = -1;
    if (R.isFixed && hit?.loc?.p === index) cur = 0;
    else if (target && target.index === index) cur = marks.findIndex((m) => m.raw === target.raw);
    const keys = [];
    marks.forEach((m, i) => {
      const key = 'fts:' + i;
      try { ov.add(key, m.range, drawMark, { night: night(), current: i === cur }); keys.push(key); } catch {}
    });
    drawn.set(doc, keys);
  }

  /** PDF pages draw their text layer after the page has loaded (and again after a zoom): mark once it is there. */
  function watch(doc) {
    const layer = doc.querySelector('.textLayer');
    if (!layer || watchers.has(doc)) return;
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(() => { if (!destroyed && layer.childElementCount) draw(doc); }, 140); };
    try { const obs = new MutationObserver(later); obs.observe(layer, { childList: true }); watchers.set(doc, { obs, cancel: () => clearTimeout(t) }); } catch {}
    if (layer.childElementCount) later();
  }

  function redrawAll() {
    for (const c of contents()) {
      if (!c.doc) continue;
      if (R.isFixed) watch(c.doc);
      draw(c.doc);
    }
  }

  /* ---------- going to the hit ---------- */
  const waitFor = async (fn, ms = 6000) => { const end = performance.now() + ms; for (;;) { const v = fn(); if (v || performance.now() > end) return v; await new Promise((r) => setTimeout(r, 60)); } };

  /** The best place of the query in section `s` of a flowing book: the first mark inside the chunk, else the nearest. */
  function pickMark(marks, loc) {
    if (!marks.length) return null;
    const inside = marks.find((m) => m.raw >= (loc.o ?? 0) && m.raw < (loc.o ?? 0) + (loc.len ?? Infinity));
    if (inside) return inside;
    return marks.reduce((best, m) => (Math.abs(m.raw - (loc.o ?? 0)) < Math.abs(best.raw - (loc.o ?? 0)) ? m : best));
  }

  async function goToHit() {
    if (!hit || !R.view) return;
    const loc = hit.loc || {};
    if (R.isFixed) {
      const p = loc.p ?? 0;
      if ((R.loc?.section?.current ?? -1) !== p) await R.goTo(p);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // a spread may report its left page: that one is where the hit is shown
      landing = R.loc?.section?.current ?? p;
      return;
    }
    const sections = R.view.book?.sections || [];
    const order = [loc.s ?? 0];
    for (let d = 1; d <= NEAR_SECTIONS; d++) order.push((loc.s ?? 0) + d, (loc.s ?? 0) - d);
    for (const s of order) {
      if (s < 0 || s >= sections.length || typeof sections[s].createDocument !== 'function') continue;
      // the section on screen is searched in place; a neighbour first in a copy (it is not loaded)
      let shown = contents().find((c) => c.index === s)?.doc;
      if (!shown) {
        let probe = null;
        try { probe = await sections[s].createDocument(); } catch {}
        if (s !== loc.s && !matchesIn(probe?.body, probe).length) continue;
        await R.goTo(s);
        shown = await waitFor(() => contents().find((c) => c.index === s)?.doc);
      }
      const m = pickMark(matchesIn(shown?.body, shown), s === loc.s ? loc : { o: 0 });
      if (!m) continue;
      target = { index: s, raw: m.raw };
      try {
        const cfi = R.view.getCFI(s, m.range);
        await R.view.goTo(cfi);
      } catch (e) { console.warn('[reader] going to the hit failed', e); }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      landing = R.loc?.location?.current ?? null;
      redrawAll();
      return;
    }
  }

  async function afterOpen() {
    if (!hit) return;
    try { await goToHit(); } catch (e) { console.warn('[reader] hit', e); }
    settling = false;
    redrawAll();
  }

  /** A hit chosen in the search panel while this book is open (the panel was opened from the reader). */
  async function goto(next) {
    if (destroyed || !next) return;
    hit = next; query = parseQuery(next.q); target = null;
    showChip();
    settling = true;
    try { await goToHit(); } catch {}
    settling = false;
    redrawAll();
  }

  function clear() {
    query = null; hit = null; target = null;
    for (const doc of [...drawn.keys()]) undraw(doc);
    showChip();
    R.els?.root?.focus?.();
  }

  /** Back to the result list: it lies under the reader when the reader came from it, else it opens again. */
  function back() {
    const q = query?.text || hit?.q || '';
    if (isPanelOpen('search')) { R.close?.(); return; }
    R.ctx.openPanel('search', { q, from: 'reader', bookId: R.record?.id || null });
  }

  /** The full-text search from the reader (Strg+F, the button): `text`, the query of the marks or the selected text. */
  function openPanel(text) {
    let q = typeof text === 'string' && text ? text : query?.text || '';
    if (!q) {
      try { for (const doc of R.docs()) { const s = doc.getSelection?.()?.toString().replace(/\s+/g, ' ').trim(); if (s) { q = s.slice(0, 80); break; } } } catch {}
    }
    R.ctx.openPanel('search', { q, from: 'reader', bookId: R.record?.id || null });
  }

  const offGoto = bus.on('reader:goto-hit', (p) => { if (p && p.id && p.id === R.record?.id) goto(p.hit); });

  return {
    el,
    /** where the reader opens: the hit's page or section instead of the last reading position */
    initialTarget: () => (hit ? (R.params?.hit?.loc?.p ?? R.params?.hit?.loc?.s ?? null) : null),
    afterOpen,
    onLoad(doc) { if (!query) return; if (R.isFixed) watch(doc); else draw(doc); },
    onCreateOverlay({ index }) { const c = contents().find((x) => x.index === index); if (c?.doc && query) draw(c.doc); },
    /** true while the reader only peeks at the hit: the position is not saved (it moves once a page is turned) */
    isPeek(detail) {
      if (!peek) return false;
      // the book left at the seat after reading shows the page it was read at, not the hit
      if (R.currentPageText == null) R.currentPageText = R.record?.currentPageText || '';
      if (settling || landing == null) return true;
      const cur = R.isFixed ? detail?.section?.current : detail?.location?.current;
      if (cur !== landing) peek = false;
      return peek;
    },
    openPanel, clear, goto,
    active: () => !!query,
    destroy() {
      destroyed = true;
      offGoto?.();
      for (const w of watchers.values()) { try { w.obs.disconnect(); w.cancel(); } catch {} }
      watchers.clear();
    },
  };
}
