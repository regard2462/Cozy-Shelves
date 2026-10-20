// The text view of a PDF, part 2: a reflowable foliate "book" (see text-book.js) made from the pages of a PDF, so that
// a PDF reads like an EPUB with the reader's font, size, line height, page width and page colour.
//
//   sections   runs of pages: a chapter of the outline, or about ten pages (long chapters are split). A section is
//              built when it is first shown: the pages are read (pdf-text-extract.js), put together
//              (pdf-text-assemble.js), their figures rendered into pictures, then the HTML goes into a blob: URL.
//              The neighbours follow while the reader idles, then the text of the remaining pages.
//   pages      every PDF page has an invisible marker (<span class="tv-pg" id="tv-p12">) where its text begins, also in
//              the middle of a paragraph that runs on: position, progress, bookmarks, "zuletzt gelesen" and the switch
//              back to the page view all speak in PDF pages.
//   CFIs       the sections have their own CFI space (epubcfi(/8/…)); a CFI of the page view (epubcfi(/6/2n)…) is read
//              as its page (resolveCFI).
//   cache      per book, in this session: the page models (text, small) and the built sections with their pictures,
//              bounded (IMAGE_BUDGET); the pictures of other books are dropped when another book is shown.
import { extractPage, renderRegion } from './pdf-text-extract.js';
import { assemblePage, buildSection, continues, documentBodySize, headKey, markerId, ASSEMBLY_VERSION } from './pdf-text-assemble.js';
import { THEMES } from './reader-styles.js';
import { chooseLanguage } from './tts-lang.js';

// Soft hyphens are part of the text of a section from the start, whatever the reader's switch says (the CSS turns
// them on or off): the offsets of positions and highlights in the text view stay the same. CSS hyphenation has no
// dictionaries in Electron on Windows, so the TeX patterns of the "hyphen" package do it (as in the reading browser).
const HYPHENATORS = { de: () => import('hyphen/de'), en: () => import('hyphen/en') };
const hyphenLoads = {};
function hyphenator(lang) {
  if (!HYPHENATORS[lang]) return Promise.resolve(null);
  hyphenLoads[lang] ||= HYPHENATORS[lang]().then((m) => {
    const fn = m.hyphenateSync || m.default?.hyphenateSync;
    return fn ? (text) => { try { return fn(text, { minWordLength: 6 }); } catch { return text; } } : null;
  }).catch((e) => { console.warn('[reader] hyphenation unavailable', e?.message); return null; });
  return hyphenLoads[lang];
}

const SECTION_PAGES = 10;           // pages per section when the outline says nothing
const MAX_SECTION_PAGES = 14;        // a longer chapter is split
const IMAGE_BUDGET = 96 * 1024 * 1024;
const MODEL_BUDGET = 40 * 1024 * 1024;   // about chars × 4 of the kept page models
const store = new Map();             // book key → data (session)
const PAGE_CFI = /^epubcfi\(\/6\/(\d+)/;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const idle = (fn, timeout = 1500) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 60));
const cancelIdle = (h) => { try { (window.cancelIdleCallback || clearTimeout)(h); } catch {} };
/** for the checks: window.__tvTrace = [] collects what was built and how long it took */
const trace = (what, t0) => { try { if (Array.isArray(window.__tvTrace)) window.__tvTrace.push({ what, at: Math.round(t0), ms: Math.round(performance.now() - t0) }); } catch {} };

/** The page index of a page CFI of the PDF view (epubcfi(/6/2n)), or null. */
export const pageOfPdfCfi = (cfi) => { const m = PAGE_CFI.exec(String(cfi || '')); return m ? +m[1] / 2 - 1 : null; };
export const pdfPageCfi = (page) => `epubcfi(/6/${(page + 1) * 2})`;
export const TEXT_CFI_PREFIX = 'epubcfi(/8/';

// ------------------------------------------------------------------------------------------------- the look
// SVG colour filters for the pictures of a section: the page colours of the reader (reader-styles.js THEMES). Paper
// and sepia multiply (white paper turns into the page), night inverts drawings and scans with their hues kept (white
// becomes the night page, black its ink) and only dims photos.
const lin = (v) => +(v / 255).toFixed(4);
const H180 = [[-0.574, 1.430, 0.144], [0.426, 0.430, 0.144], [0.426, 1.430, -0.856]];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Scanned pages first get a white point (their greyish paper becomes white, so it turns into the page colour too).
function filterDefs() {
  const mult = (rgb) => `${lin(rgb[0])} 0 0 0 0  0 ${lin(rgb[1])} 0 0 0  0 0 ${lin(rgb[2])} 0 0  0 0 0 1 0`;
  const bg = hex(THEMES.night.bg), fg = hex(THEMES.night.fg);
  const night = [0, 1, 2].map((i) => { const span = (fg[i] - bg[i]) / 255; return [...H180[i].map((h) => +(-span * h).toFixed(4)), 0, lin(fg[i])].join(' '); }).join('  ') + '  0 0 0 1 0';
  const level = '<feComponentTransfer><feFuncR type="linear" slope="1.14" intercept="-0.06"/><feFuncG type="linear" slope="1.14" intercept="-0.06"/><feFuncB type="linear" slope="1.14" intercept="-0.06"/></feComponentTransfer>';
  const f = (id, values, scan = false) => `<filter id="${id}" color-interpolation-filters="sRGB">${scan ? level : ''}${values ? `<feColorMatrix type="matrix" values="${values}"/>` : ''}</filter>`;
  const set = [['paper', mult(hex(THEMES.paper.bg))], ['sepia', mult(hex(THEMES.sepia.bg))], ['night', night]];
  return `<svg class="tv-defs" aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0">${set.map(([k, v]) => f(`tv-f-${k}`, v) + f(`tv-f-${k}-scan`, v, true)).join('')}${f('tv-f-white-scan', null, true)}${f('tv-f-dim', mult([206, 198, 186]))}</svg>`;
}
const TV_CSS = `
  html { margin: 0; padding: 0; } body { margin: 0; padding: 0; }
  .tv-pg { display: inline; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; text-align: start; break-after: avoid; font-weight: 600; -webkit-hyphens: manual; hyphens: manual; }
  h1 { font-size: 1.75em; text-align: center; margin: 1.2em 0 .9em; }
  h2 { font-size: 1.42em; margin: 1.5em 0 .7em; }
  h3 { font-size: 1.18em; margin: 1.3em 0 .5em; }
  h4, h5, h6 { font-size: 1.04em; margin: 1.1em 0 .4em; }
  h1 b, h2 b, h3 b, h4 b, h5 b, h6 b { font-weight: inherit; }
  p { margin: 0; text-indent: 1.5em; }
  p.tv-noindent { text-indent: 0; margin-top: .55em; }
  :is(h1, h2, h3, h4, h5, h6, figure, .tv-list, aside) + p, p:first-child { text-indent: 0; margin-top: 0; }
  :is(h1, h2, h3, h4, h5, h6) + p.tv-noindent { margin-top: 0; }
  p.tv-center { text-indent: 0; text-align: center; margin: .6em 0; }
  .tv-h.tv-center { text-align: center; }
  .tv-list { margin: .5em 0; padding-inline-start: 1.7em; }
  .tv-list li { margin: .15em 0; }
  figure.tv-fig { margin: 1em auto; text-align: center; break-inside: avoid; }
  figure.tv-fig img { display: block; margin: 0 auto; width: 100%; height: auto; }
  figure.tv-page { width: 100%; margin: .6em auto; }
  /* drawings and scans have the paper of the PDF around them: its edge fades into the page */
  figure.tv-drawing img, figure.tv-page img {
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%), linear-gradient(180deg, transparent 0, #000 8px, #000 calc(100% - 8px), transparent 100%);
    -webkit-mask-composite: source-in; mask-composite: intersect;
  }
  figcaption { font-size: .84em; line-height: 1.35; margin-top: .5em; text-align: center; -webkit-hyphens: manual; hyphens: manual; }
  aside.tv-notes { font-size: .8em; margin: .8em 0 1.1em; padding-top: .3em; border-top: 1px solid; border-image: linear-gradient(90deg, currentColor 0, currentColor 5em, transparent 5em) 1; }
  aside.tv-notes p { text-indent: 0; margin: .2em 0; line-height: 1.4 !important; }
  sup { font-size: .68em; line-height: 0; vertical-align: .55em; }
  code { font-size: .9em; }
`;

// ------------------------------------------------------------------------------------------------- the book data
function bookData(key) {
  let d = store.get(key);
  if (d) { store.delete(key); store.set(key, d); return d; }   // most recent last
  d = { key, models: new Map(), pending: new Map(), sections: new Map(), imageBytes: 0, modelBytes: 0, lead: new Map(), init: null };
  store.set(key, d);
  // only the pictures of the book in use stay (text models of two books)
  for (const [k, other] of store) if (k !== key) dropSections(other);
  while (store.size > 2) { const [k, other] = store.entries().next().value; dropSections(other); store.delete(k); }
  return d;
}
function dropSections(d, keep = null) {
  for (const [k, s] of d.sections) {
    if (keep?.has(k)) continue;
    for (const u of s.urls) URL.revokeObjectURL(u);
    d.imageBytes -= s.bytes;
    d.sections.delete(k);
  }
}

/** Page starts of the sections: the chapters of the outline (split when long), else runs of SECTION_PAGES pages. */
export function sectionRanges(numPages, starts = []) {
  const s = [...new Set([0, ...starts.filter((p) => p > 0 && p < numPages)])].sort((a, b) => a - b);
  const out = [];
  s.forEach((first, i) => {
    const end = i + 1 < s.length ? s[i + 1] : numPages;
    const len = end - first;
    const n = len > MAX_SECTION_PAGES ? Math.ceil(len / SECTION_PAGES) : 1;
    const size = Math.ceil(len / n);
    for (let a = first; a < end; a += size) out.push([a, Math.min(end, a + size) - 1]);
  });
  return out;
}

async function resolveOutline(pdf) {
  let outline = null;
  try { outline = await pdf.getOutline(); } catch { outline = null; }
  if (!outline?.length) return [];
  let count = 0;
  // the entries of a level are resolved together (each one asks the pdf.js worker), at most 2000 in all
  const walk = (items, depth) => Promise.all(items.filter(() => ++count <= 2000).map(async (it) => {
    let page = null;
    try {
      const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
      if (Array.isArray(dest) && dest[0]) page = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : (Number.isInteger(dest[0]) ? dest[0] : null);
    } catch { page = null; }
    const subitems = it.items?.length ? await walk(it.items, depth + 1) : [];
    return { label: String(it.title || '').trim(), page, depth, subitems };
  }));
  return walk(outline, 0);
}

/** The font size of the running text from a few pages spread over the book (text content only, cheap). */
async function sampleBody(pdf) {
  const n = pdf.numPages;
  const picks = [...new Set(Array.from({ length: Math.min(8, n) }, (_, i) => Math.floor((n * (i + 1)) / (Math.min(8, n) + 1))))];
  const raws = [];
  for (const p of picks) {
    try {
      const page = await pdf.getPage(p + 1);
      const tc = await page.getTextContent();
      raws.push({ items: tc.items.filter((it) => it.str?.trim() && it.transform).map((it) => ({ s: it.str, h: Math.hypot(it.transform[2], it.transform[3]) })) });
    } catch { /* a broken page */ }
  }
  return documentBodySize(raws);
}

// ------------------------------------------------------------------------------------------------- the view
/**
 * @param {{ pdf: object, key: string, title?: string, lang?: string, chess?: boolean, CFI: object, onProgress?: Function }} o
 *   pdf: the pdf.js document of the PDF book (book.pdf), key: the book (id, size, date), CFI: foliate's epubcfi.js
 */
export async function createTextView(o) {
  const { pdf, CFI } = o;
  const d = bookData(o.key);
  const numPages = pdf.numPages;
  if (!d.init) {
    d.init = (async () => {
      const [outline, body] = await Promise.all([resolveOutline(pdf), sampleBody(pdf)]);
      const flat = [];
      const walk = (items) => { for (const it of items) { flat.push(it); walk(it.subitems); } };
      walk(outline);
      // chapters: the top entries; their sub entries where a chapter is long
      const top = outline.filter((it) => it.page != null).map((it) => it.page);
      const starts = new Set(top);
      outline.forEach((it, i) => {
        const end = outline.slice(i + 1).find((x) => x.page != null)?.page ?? numPages;
        if (it.page != null && end - it.page > MAX_SECTION_PAGES) for (const s of it.subitems) if (s.page != null) starts.add(s.page);
      });
      const titles = new Set([o.title, ...flat.map((it) => it.label)].filter(Boolean).map(headKey));
      return { outline, body, titles, ranges: sectionRanges(numPages, [...starts]) };
    })();
  }
  const info = await d.init;
  const { ranges } = info;
  const sectionOfPage = new Int32Array(numPages);
  ranges.forEach(([a, b], k) => { for (let p = a; p <= b; p++) sectionOfPage[p] = k; });
  let destroyed = false;
  const listeners = new Set();
  const lang = (o.lang || 'de').slice(0, 5);

  // ---- page models
  function pageModel(p) {
    if (d.models.has(p)) return Promise.resolve(d.models.get(p));
    if (d.pending.has(p)) return d.pending.get(p);
    const job = (async () => {
      let model;
      const t0 = performance.now();
      try {
        const raw = await extractPage(pdf, p);
        const t1 = performance.now();
        model = assemblePage(raw, { body: info.body, titles: info.titles, chess: !!o.chess });
        trace(`assemble ${p}`, t1);
        trace(`page ${p}`, t0);
      } catch (e) {
        console.warn('[reader] text view: page', p + 1, e);
        model = { index: p, w: 595, h: 842, kind: 'image', reason: 'error', blocks: [], notes: [], figures: [], chars: 0 };
      }
      d.models.set(p, model);
      d.pending.delete(p);
      d.modelBytes += 600 + (model.chars || 0) * 4;
      return model;
    })();
    d.pending.set(p, job);
    return job;
  }

  /** whether the section before `k` ends with the first paragraph of page ranges[k][0] */
  async function leadTaken(k) {
    if (k <= 0) return false;
    if (d.lead.has(k)) return d.lead.get(k);
    const first = ranges[k][0];
    const [prev, cur] = await Promise.all([pageModel(first - 1), pageModel(first)]);
    let taken = false;
    if (prev.kind === 'text' && cur.kind === 'text' && prev.blocks.length) {
      const last = prev.blocks[prev.blocks.length - 1];
      // the paragraph that ends the section before is the last block of its last page, or that page's continued first
      // block when it is the only one (then the page before it decides: the chain is followed by continues())
      taken = last.t === 'p' && continues(last, cur.blocks[0]);
    }
    d.lead.set(k, taken);
    return taken;
  }

  // ---- pictures
  async function picture(page, rect, kind) {
    const t0 = performance.now();
    const longest = Math.max(rect.w, rect.h);
    let scale = kind === 'page' ? Math.min(3.4, 1700 / Math.max(1, page.w)) : 2.6;
    if (kind !== 'page' && o.chess) scale = Math.max(scale, 1050 / longest);      // diagrams: enough pixels for the snip
    if (kind !== 'page') scale = Math.max(scale, 360 / longest);
    scale = Math.min(scale, 2400 / longest);
    let canvas = await renderRegion(pdf, page.index, rect, scale);
    // a page that is a picture as a whole (a scan) is cut to what is printed on it: no wide empty margins in the text
    if (kind === 'page') {
      const box = printedBox(canvas);
      if (box) {
        const c = document.createElement('canvas');
        c.width = box.w; c.height = box.h;
        c.getContext('2d', { alpha: false }).drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
        canvas.width = canvas.height = 0;
        canvas = c;
        rect = { x: rect.x + box.x / scale, y: rect.y + box.y / scale, w: box.w / scale, h: box.h / scale };
      }
    }
    const photo = kind === 'photo' || kind === 'page';
    const w = canvas.width, h = canvas.height;
    const blob = await new Promise((res) => canvas.toBlob(res, photo ? 'image/jpeg' : 'image/png', photo ? 0.9 : undefined));
    canvas.width = canvas.height = 0;
    trace(`picture ${page.index} ${kind}`, t0);
    if (!blob) throw new Error('no picture');
    return { url: URL.createObjectURL(blob), w, h, bytes: blob.size, rect };
  }
  /** The part of a rendered page that carries print (from a small copy: the paper is the brightness most pixels have),
   *  with a margin, in canvas pixels; null when it is (nearly) the whole page or nothing is printed. */
  function printedBox(canvas) {
    const W = 240, H = Math.max(1, Math.round((canvas.height * W) / canvas.width));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const lum = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) lum[i] = (px[4 * i] * 77 + px[4 * i + 1] * 150 + px[4 * i + 2] * 29) >> 8;
    const paper = [...lum].sort((a, b) => a - b)[Math.floor(W * H * 0.75)];
    const dark = paper - Math.max(40, paper * 0.2);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lum[y * W + x] < dark) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const m = 0.03;
    x0 = Math.max(0, x0 - W * m); y0 = Math.max(0, y0 - H * m * 0.7); x1 = Math.min(W, x1 + 1 + W * m); y1 = Math.min(H, y1 + 1 + H * m * 0.7);
    if ((x1 - x0) * (y1 - y0) > 0.92 * W * H) return null;
    const k = canvas.width / W;
    return { x: Math.round(x0 * k), y: Math.round(y0 * k), w: Math.round((x1 - x0) * k), h: Math.round((y1 - y0) * k) };
  }

  // ---- sections
  async function buildSectionOf(k) {
    if (d.sections.has(k)) { const s = d.sections.get(k); s.used = performance.now(); return s; }
    if (d.building?.has(k)) return d.building.get(k);
    d.building ||= new Map();
    const job = (async () => {
      const [first, last] = ranges[k];
      const pages = [];
      for (let p = first; p <= last; p++) pages.push(pageModel(p));
      const next = last + 1 < numPages ? pageModel(last + 1) : null;
      const models = await Promise.all(pages);
      const nextModel = next ? await next : null;
      const skipLead = await leadTaken(k);
      // the pictures of the section, rendered one after the other (each one renders a page)
      const urls = [], pics = new Map();
      let bytes = 0;
      const textW = (m) => {
        const lines = m.blocks.filter((b) => b.t === 'p' && b.right && b.left);
        return lines.length ? Math.max(...lines.map((b) => b.right)) - Math.min(...lines.map((b) => b.left)) : m.w * 0.75;
      };
      for (const m of models) {
        if (destroyed) break;
        if (m.kind === 'image') {
          try { const pic = await picture(m, { x: 0, y: 0, w: m.w, h: m.h }, 'page'); pics.set(`${m.index}:page`, pic); urls.push(pic.url); bytes += pic.bytes; }
          catch (e) { console.warn('[reader] text view: page picture', e); }
          continue;
        }
        for (const f of m.figures) {
          const kind = f.kind === 'photo' ? 'photo' : 'drawing';
          try { const pic = await picture(m, f, kind); pics.set(`${m.index}:${f.id}`, pic); urls.push(pic.url); bytes += pic.bytes; }
          catch (e) { console.warn('[reader] text view: figure', e); }
        }
      }
      const square = (f) => f.w / f.h > 0.8 && f.w / f.h < 1.25;
      const figureHtml = (m, f, cap) => {
        const pic = pics.get(`${m.index}:${f.id}`);
        const cls = f.kind === 'photo' ? 'tv-photo' : o.chess && square(f) ? 'tv-chess' : 'tv-drawing';
        const pct = Math.max(30, Math.min(100, Math.round((f.w / textW(m)) * 100)));
        const img = pic ? `<img src="${pic.url}" width="${pic.w}" height="${pic.h}" alt="">` : '';
        return `<figure class="tv-fig ${cls}" style="width:${pct}%" data-page="${m.index}" data-rect="${[f.x, f.y, f.w, f.h].map((v) => Math.round(v * 10) / 10).join(',')}">${img}${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
      };
      const pageHtml = (m) => {
        const pic = pics.get(`${m.index}:page`);
        const r = pic?.rect || { x: 0, y: 0, w: m.w, h: m.h };
        return `<figure class="tv-fig tv-page tv-drawing" data-page="${m.index}" data-rect="${[r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10).join(',')}">${pic ? `<img src="${pic.url}" width="${pic.w}" height="${pic.h}" alt="">` : ''}</figure>`;
      };
      // the language of the section from its text (the metadata of PDFs is often wrong), for the hyphenation
      const sample = models.flatMap((m) => (m.blocks || []).filter((b) => b.t === 'p').map((b) => b.text)).join(' ').slice(0, 4000);
      const secLang = sample.length > 80 ? chooseLanguage(sample, { meta: o.lang, ui: o.uiLang }).lang : (lang.slice(0, 2) || 'de');
      const hyphenate = await hyphenator(secLang);
      const { html, tookLead } = buildSection(models, { nextPage: nextModel, skipLead, figureHtml, pageHtml, hyphenate });
      if (k + 1 < ranges.length) d.lead.set(k + 1, tookLead);
      const title = esc(info.outline.find((it) => it.page === first)?.label || o.title || '');
      const doc = `<!DOCTYPE html><html lang="${esc(secLang)}"><head><meta charset="utf-8"><title>${title}</title><style>${TV_CSS}</style></head><body class="tv">${filterDefs()}\n${html}</body></html>`;
      const url = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
      urls.push(url);
      const s = { url, html: doc, urls, bytes, used: performance.now(), pages: [first, last], tookLead };
      d.building.delete(k);
      if (destroyed) { for (const u of urls) URL.revokeObjectURL(u); return s; }
      d.sections.set(k, s);
      d.imageBytes += bytes;
      trim(k);
      for (const fn of listeners) { try { fn({ type: 'section', index: k }); } catch {} }
      return s;
    })();
    d.building.set(k, job);
    job.catch(() => d.building.delete(k));
    return job;
  }
  /** the pictures over budget go, oldest first, never the shown section and its neighbours */
  let current = 0;
  function trim(justBuilt) {
    if (d.imageBytes <= IMAGE_BUDGET) return;
    const keep = new Set([current - 1, current, current + 1, justBuilt]);
    const old = [...d.sections.entries()].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [k, s] of old) {
      if (d.imageBytes <= IMAGE_BUDGET * 0.8) break;
      for (const u of s.urls) URL.revokeObjectURL(u);
      d.imageBytes -= s.bytes;
      d.sections.delete(k);
    }
  }

  // ---- idle work: the neighbours of the shown section, then the text of the other pages
  let idleHandle = null, waitTimer = null, idleQueue = [], paused = false, quietUntil = 0;
  function schedule() {
    if (destroyed || idleHandle || waitTimer || paused) return;
    idleHandle = idle(async (deadline) => {
      idleHandle = null;
      if (destroyed || paused) return;
      // right after the reader did something (a page turn, a switch) the next job waits a moment
      const wait = quietUntil - performance.now();
      if (wait > 0) { waitTimer = setTimeout(() => { waitTimer = null; schedule(); }, wait); return; }
      const job = idleQueue.shift();
      if (job == null) return;
      try {
        if (typeof job === 'string') await buildSectionOf(+job.slice(1));
        else if (!d.models.has(job) && d.modelBytes < MODEL_BUDGET) await pageModel(job);
      } catch { /* the next one */ }
      void deadline;
      schedule();
    }, 2500);
  }
  function plan(k) {
    current = k;
    quietUntil = performance.now() + 1200;
    const near = [k + 1, k - 1].filter((x) => x >= 0 && x < ranges.length && !d.sections.has(x)).map((x) => 's' + x);
    const order = [];
    for (let dist = 1; dist < numPages; dist++) {
      const a = ranges[k][1] + dist, b = ranges[k][0] - dist;
      if (a < numPages) order.push(a);
      if (b >= 0) order.push(b);
      if (a >= numPages && b < 0) break;
    }
    idleQueue = [...near, ...order.filter((p) => !d.models.has(p))];
    schedule();
  }

  // ---- the foliate book
  const sectionCfi = (k) => `epubcfi(/8/${(k + 1) * 2})`;
  const sections = ranges.map(([a, b], k) => ({
    id: k,
    cfi: sectionCfi(k),
    linear: 'yes',
    size: (b - a + 1) * 1500,
    load: async () => { const s = await buildSectionOf(k); plan(k); return s.url; },
    unload: () => {},
    createDocument: async () => new DOMParser().parseFromString((await buildSectionOf(k)).html, 'text/html'),
    resolveHref: (href) => String(href ?? ''),
  }));
  const markerOf = (doc, page) => doc.getElementById(markerId(page));
  /** where page `page` begins: its section (the one before, when that one finishes the page's first paragraph) */
  async function placeOf(page) {
    page = Math.max(0, Math.min(numPages - 1, page | 0));
    let k = sectionOfPage[page];
    if (ranges[k][0] === page && await leadTaken(k)) k -= 1;
    return { index: k, anchor: (doc) => markerOf(doc, page) || doc.body };
  }
  const tocItems = (items) => items.filter((it) => it.page != null || it.subitems.length).map((it) => ({
    label: it.label, href: it.page != null ? `tvp:${it.page}` : `tvp:${it.subitems.find((s) => s.page != null)?.page ?? 0}`,
    subitems: it.subitems.length ? tocItems(it.subitems) : null,
  }));
  const parsePage = (href) => { const m = /^tvp:(\d+)/.exec(String(href || '')); return m ? +m[1] : null; };
  const book = {
    metadata: { title: o.title || '', author: o.author || '', language: lang },
    dir: 'ltr',
    sections,
    toc: tocItems(info.outline),
    resolveHref: (href) => {
      const page = parsePage(href);
      if (page != null) return placeOf(page);
      const [a, frag] = String(href || '').split('#');
      const index = /^\d+$/.test(a) ? +a : 0;
      return { index, anchor: (doc) => (frag ? doc.getElementById(frag) : null) || doc.body };
    },
    resolveCFI: (cfi) => {
      const page = pageOfPdfCfi(cfi);
      if (page != null && !String(cfi).startsWith(TEXT_CFI_PREFIX)) return placeOf(page);
      const parts = CFI.parse(cfi);
      const head = (parts.parent ?? parts).shift();
      const index = head.at(-1).index / 2 - 1;
      return { index, anchor: (doc) => CFI.toRange(doc, parts) };
    },
    splitTOCHref: (href) => { const page = parsePage(href) ?? 0; return [sectionOfPage[Math.min(numPages - 1, page)], markerId(page)]; },
    getTOCFragment: (doc, id) => doc.getElementById(id) || doc.body,
    isExternal: (uri) => /^[a-z][a-z0-9+.-]*:/i.test(String(uri || '')) && !/^tvp:/i.test(String(uri || '')),
    destroy: () => {},
  };

  // ---- pages of a position
  /** The PDF pages on screen: the page where the visible range starts and the last page that begins on it. */
  function pagesOf(range, index) {
    const doc = range?.startContainer?.ownerDocument;
    const first = ranges[index]?.[0] ?? 0;
    if (!doc) return [first, first];
    const marks = [...doc.querySelectorAll('.tv-pg')];
    let start = null, end = null;
    for (const m of marks) {
      let cmp = 0;
      try { cmp = range.comparePoint(m, 0); } catch { cmp = 0; }
      const p = +m.dataset.page;
      if (cmp < 0) start = p;
      else if (cmp === 0) { if (start == null) start = p; end = p; }
      else break;
    }
    if (start == null) start = marks.length ? +marks[0].dataset.page : first;
    return [start, Math.max(start, end ?? start)];
  }
  /** The place in the text view for a target of the reader: a page index, a page CFI of the PDF view, a CFI of the
   *  text view, a TOC href. Returns something view.goTo() takes. */
  function mapTarget(target) {
    if (typeof target === 'number') return `tvp:${target}`;
    const page = pageOfPdfCfi(target);
    if (page != null && !String(target).startsWith(TEXT_CFI_PREFIX)) return `tvp:${page}`;
    return target;
  }

  return {
    book, numPages, ranges, ASSEMBLY_VERSION,
    pagesOf, mapTarget, hrefOfPage: (p) => `tvp:${p}`, sectionOfPage: (p) => sectionOfPage[p],
    /** the section of `page` built (before the view shows it: no empty frame while it is put together) */
    prepare: async (page) => { const k = (await placeOf(page)).index; await buildSectionOf(k); },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    /** for the checks: what is built */
    stats: () => ({ pages: d.models.size, sections: [...d.sections.keys()], imageBytes: d.imageBytes, modelBytes: d.modelBytes, ranges }),
    model: (p) => d.models.get(p) || null,
    pageModel,
    /** the page view is shown: no building in the background (pdf.js renders the pages), until resume() */
    pause() { paused = true; cancelIdle(idleHandle); clearTimeout(waitTimer); idleHandle = waitTimer = null; },
    resume() { if (!paused) return; paused = false; quietUntil = performance.now() + 1500; schedule(); },
    /** the reader turned a page or moved: the background work waits a moment */
    touch() { quietUntil = performance.now() + 1000; },
    destroy() {
      destroyed = true;
      cancelIdle(idleHandle); clearTimeout(waitTimer); idleHandle = waitTimer = null; idleQueue = [];
      listeners.clear();
      // the pictures go with the reader; the text of the pages stays for this session
      dropSections(d);
    },
  };
}
