// Page colours for fixed-layout pages (PDF, comics, fixed-layout EPUB). These pages are pictures: pdf.js draws a
// PDF page into a canvas, a comic page is an image. The reader's page theme reaches them as an SVG colour filter
// inside each page document (CSS from outside cannot multiply with a colour, and sepia() leaves white paper white):
//   white          the page as it is
//   paper, sepia   multiply with a paper colour: white paper turns warm, ink stays dark, pictures keep their colours
//   night          PDF: the brightness is inverted with the hues kept (dark page, light text); the raster pictures of
//                  the page (photos, diagrams as images, from the operator list, see vendor-src/foliate-js/pdf.js) and
//                  the regions in `keep` (chess diagrams found on the page) are put back on top in their own colours,
//                  only dimmed. A picture that covers most of the page is a scan and is inverted with the page.
//                  Comics and fixed-layout EPUB pages are dimmed, never inverted.
// The filters are composited on the GPU; turning a page costs one style element and a few small canvas copies.
import { PAGE_TINTS } from './reader-styles.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'rd-page-theme';

// hue-rotate(180deg) from the Filter Effects spec; its rows add up to 1, so greys stay grey
const H180 = [[-0.574, 1.430, 0.144], [0.426, 0.430, 0.144], [0.426, 1.430, -0.856]];
const f = (v) => +v.toFixed(4);
const multiply = (rgb) => { const [r, g, b] = rgb.map((v) => f(v / 255)); return `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0`; };
/** white → bg, black → fg, colours keep their hue: z = fg − (fg − bg) · H180 · x */
function nightMatrix({ bg, fg }) {
  const rows = [0, 1, 2].map((i) => {
    const span = (fg[i] - bg[i]) / 255;
    return [...H180[i].map((h) => f(-span * h)), 0, f(fg[i] / 255)].join(' ');
  });
  return rows.join('  ') + '  0 0 0 1 0';
}

const FILTERS = {
  'rd-pf-paper': multiply(PAGE_TINTS.paper),
  'rd-pf-sepia': multiply(PAGE_TINTS.sepia),
  'rd-pf-night': nightMatrix(PAGE_TINTS.night),
  // pictures on night pages and comics at night: dimmed, a little warmer
  'rd-pf-dim': multiply([206, 198, 186]),
};

const CSS = `
  html[data-rd-page="paper"] #canvas > canvas, html[data-rd-page="paper"]:not(.rd-pdf) body { filter: url(#rd-pf-paper); }
  html[data-rd-page="sepia"] #canvas > canvas, html[data-rd-page="sepia"]:not(.rd-pdf) body { filter: url(#rd-pf-sepia); }
  html[data-rd-page="night"] #canvas > canvas { filter: url(#rd-pf-night); }
  html[data-rd-page="night"]:not(.rd-pdf) body, html[data-rd-page="night"] .rd-keep > canvas { filter: url(#rd-pf-dim); }
  .rd-keep { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; }
  .rd-keep > canvas { position: absolute; display: block; }
  #rd-page-filters { position: absolute; width: 0; height: 0; overflow: hidden; }
`;

/** Pictures below this share of the page stay inverted (icons, rules); above `SCAN` they are the page itself. */
const MIN_AREA = 0.004, MIN_SIDE = 24, SCAN = 0.6;

export function createPageTheme() {
  const observers = new Set();
  const keepExtra = new WeakMap();   // doc → [{x, y, w, h}] in canvas pixels (chess diagrams found on the page)
  let finder = null;                 // canvas → rects of chess diagrams (chess books), see setFinder
  const scanned = new WeakSet();     // canvases already searched for diagrams

  function install(doc) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).append(style);
    const svg = doc.createElementNS(SVGNS, 'svg');
    svg.id = 'rd-page-filters';
    svg.setAttribute('aria-hidden', 'true');
    for (const [id, values] of Object.entries(FILTERS)) {
      const filter = doc.createElementNS(SVGNS, 'filter');
      filter.id = id;
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const m = doc.createElementNS(SVGNS, 'feColorMatrix');
      m.setAttribute('type', 'matrix');
      m.setAttribute('values', values);
      filter.append(m);
      svg.append(filter);
    }
    (doc.body || doc.documentElement).append(svg);
    const host = doc.getElementById('canvas');
    if (host) {
      doc.documentElement.classList.add('rd-pdf');
      // pdf.js replaces the canvas on every zoom: the kept pictures follow
      const obs = new MutationObserver(() => syncKeep(doc));
      obs.observe(host, { childList: true });
      observers.add(obs);
    }
  }

  function keepRects(doc, canvas) {
    const W = canvas.width, H = canvas.height, area = W * H;
    const out = [];
    for (const r of [...(canvas.imageRects || []), ...(keepExtra.get(doc) || [])]) {
      // an edge pixel belongs to the picture when the picture covers most of it; otherwise its share of white
      // paper (or, the other way round, of dark picture) shows as a light line on the night page
      const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
      const w = Math.min(W, Math.round(r.x + r.w)) - x, h = Math.min(H, Math.round(r.y + r.h)) - y;
      if (w < MIN_SIDE || h < MIN_SIDE) continue;
      const share = (w * h) / area;
      if (share < MIN_AREA || (share > SCAN && !r.keep)) continue;
      out.push({ x, y, w, h });
    }
    return out;
  }

  function syncKeep(doc) {
    const host = doc.getElementById('canvas');
    if (!host) return;
    const theme = doc.documentElement.dataset.rdPage;
    const canvas = host.querySelector('canvas');
    let layer = doc.querySelector('.rd-keep');
    if (theme !== 'night' || !canvas) { if (layer) { layer.replaceChildren(); layer.keptFor = null; } return; }
    if (!layer) { layer = doc.createElement('div'); layer.className = 'rd-keep'; host.after(layer); }
    scan(doc, canvas, layer);
    const extra = keepExtra.get(doc) || null;
    if (layer.keptFor === canvas && layer.keptExtra === extra) return;
    layer.keptFor = canvas; layer.keptExtra = extra;
    layer.replaceChildren();
    for (const r of keepRects(doc, canvas)) {
      const c = doc.createElement('canvas');
      c.width = r.w; c.height = r.h;
      c.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      Object.assign(c.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      layer.append(c);
    }
  }

  /** chess books: diagrams drawn with lines and glyphs (or inside a scanned page) are found once the reader idles */
  function scan(doc, canvas, layer) {
    if (!finder || scanned.has(canvas)) return;
    scanned.add(canvas);
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
    idle(() => {
      if (!canvas.isConnected || doc.documentElement.dataset.rdPage !== 'night') { scanned.delete(canvas); return; }
      Promise.resolve(finder(canvas)).then((rects) => {
        if (!rects?.length || !canvas.isConnected) return;
        keepExtra.set(doc, rects.map((r) => ({ ...r, keep: true })));
        layer.keptFor = null;
        syncKeep(doc);
      }).catch((e) => console.warn('[reader] diagram search failed', e));
    }, { timeout: 2000 });
  }

  return {
    /** Shows `doc` (a fixed-layout page document) in page theme `theme` ('white'|'paper'|'sepia'|'night'). */
    apply(doc, theme) {
      if (!doc?.documentElement) return;
      if (!doc.getElementById(STYLE_ID)) install(doc);
      if (doc.documentElement.dataset.rdPage !== theme) doc.documentElement.dataset.rdPage = theme;
      syncKeep(doc);
    },
    /** Extra regions (canvas pixels) of `doc` that keep their colours on night pages, e.g. chess diagrams. */
    keep(doc, rects) { keepExtra.set(doc, (rects || []).map((r) => ({ ...r, keep: true }))); syncKeep(doc); },
    /** fn(canvas) → rects of chess diagrams on a page, searched on night pages (chess books) */
    setFinder(fn) { finder = fn || null; },
    destroy() { for (const o of observers) o.disconnect(); observers.clear(); },
  };
}
