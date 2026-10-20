// Full-text search, the reading side (runs in the full-text search's own hidden window, app/fulltext.html and
// app/src/search/fulltext-window.js): the main process
// (electron/search/fulltext.js) hands over one book at a time, this module reads its text page by page and sends the
// pages back in batches. PDF pages come from pdf.js (one unit per page, the page number is the unit), EPUB, MOBI, FB2
// and the text formats from their sections as the reader shows them, cut into chunks of about 2000 characters (one
// unit each, with the section, the position in it, the print page or the reader's position, and the chapter).
// Before every page it waits while the main process holds the gate closed (the user reads, a film runs …).
import { cleanText, indexTerms, letterCount } from '../../../electron/search/textnorm.js';
import { domPieces } from './dom-text.js';
import { makeTextBook } from '../ui/reader/text-book.js';

const VENDOR = new URL('../vendor/foliate-js/', import.meta.url).href;
const FOLIATE = new Set(['epub', 'mobi', 'azw3', 'fb2', 'fbz', 'cbz']);
const CHUNK_MIN = 1500, CHUNK_MAX = 2600;   // characters per unit of a flowing book
const BATCH_UNITS = 24, BATCH_CHARS = 120000, BATCH_PAGES = 25;
const LOC_SIZE = 1500;                      // foliate's size of a "location" (the reader's "Position x von y")

let pdfjs = null, foliate = null, pdfWorker = null;
async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(/* @vite-ignore */ VENDOR + 'vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'vendor/pdfjs/pdf.worker.mjs';
  }
  return pdfjs;
}
/** One pdf.js worker for a number of books, then a fresh one: its heap is given back when its thread ends. */
const BOOKS_PER_WORKER = 20;
let workerBooks = 0;
function sharedPdfWorker(lib) {
  if (pdfWorker && workerBooks >= BOOKS_PER_WORKER) { try { pdfWorker.destroy(); } catch {} pdfWorker = null; }
  if (!pdfWorker) { pdfWorker = new lib.PDFWorker({ name: 'lesesaal-fulltext' }); workerBooks = 0; }
  workerBooks++;
  return pdfWorker;
}
async function getFoliate() {
  if (!foliate) foliate = await import(/* @vite-ignore */ VENDOR + 'view.js');
  return foliate;
}

/* ---------- the gate: closed while the user reads, listens, watches or the world needs the time ---------- */
let gateOpen = true;
let waiters = [];
function setGate(open) {
  gateOpen = !!open;
  if (gateOpen) { const w = waiters; waiters = []; for (const fn of w) fn(); }
}
const ABORT = new Error('aborted');
async function pass(job) {
  if (job.aborted) throw ABORT;
  while (!gateOpen && !job.aborted) await new Promise((r) => waiters.push(r));
  // a short breath between pages: the window also decodes covers for the library
  await new Promise((r) => setTimeout(r, 0));
  if (job.aborted) throw ABORT;
}

/* ---------- batches of units to the main process ---------- */
class Sink {
  constructor(api, job) { this.api = api; this.job = job; this.batch = []; this.chars = 0; this.units = 0; this.pending = 0; }
  async add(unit) {
    this.batch.push(unit); this.chars += unit.text.length;
    if (this.batch.length >= BATCH_UNITS || this.chars >= BATCH_CHARS) await this.flush(unit.u + 1);
  }
  /** `next`: the first unit not read yet (pages without text count as read) */
  async flush(next) {
    const batch = this.batch;
    this.batch = []; this.chars = 0; this.pending = 0;
    const r = await this.api.fulltextUnits(this.job.jobId, batch, next, { units: this.units });
    if (r?.stop) this.job.aborted = true;
    if (r && r.open === false) setGate(false);
  }
}

/* ---------- PDF: one unit per page ---------- */
async function readPdf(job, sink) {
  const lib = await getPdfjs();
  const task = lib.getDocument({ url: job.url, worker: sharedPdfWorker(lib), disableAutoFetch: true, isEvalSupported: false, cMapUrl: VENDOR + 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'vendor/pdfjs/standard_fonts/' });
  let pdf;
  try { pdf = await task.promise; }
  catch (e) {
    // a worker that broke down is replaced for the next book
    if (/worker/i.test(String(e?.message))) { try { pdfWorker?.destroy(); } catch {} pdfWorker = null; }
    throw e;
  }
  try {
    sink.units = pdf.numPages;
    for (let i = job.from || 0; i < pdf.numPages; i++) {
      await pass(job);
      let text = '';
      try {
        const page = await pdf.getPage(i + 1);
        const tc = await page.getTextContent();
        page.cleanup();
        // the same pieces as the text layer in the reader: every item, a line break after an item with hasEOL
        text = cleanText(tc.items.map((it) => ({ str: it.str || '', eol: !!it.hasEOL }))).text;
      } catch (e) { if (job.aborted) throw ABORT; console.warn('[fulltext] page failed', job.name, i + 1, e?.message); }
      if (letterCount(text)) await sink.add({ u: i, text, terms: indexTerms(text) });
      else if (++sink.pending >= BATCH_PAGES) await sink.flush(i + 1);
    }
    await sink.flush(pdf.numPages);
    return pdf.numPages;
  } finally { try { await pdf.destroy(); } catch {} }
}

/* ---------- flowing books (foliate sections, the text formats through text-book.js) ---------- */
function flattenToc(items, out = []) {
  for (const it of items || []) { if (it?.href) out.push(it); if (it?.subitems?.length) flattenToc(it.subitems, out); }
  return out;
}
const label = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map(label).join(' ') : x && typeof x === 'object' ? label(Object.values(x)[0]) : String(x ?? '')).replace(/\s+/g, ' ').trim();

/** Chunk boundaries of a cleaned text: [[a, b]] with b - a ≤ CHUNK_MAX, cut at paragraphs, sentences or spaces;
 *  `breaks` (sorted positions) always start a new chunk (print page anchors). */
function chunks(text, breaks) {
  const out = [];
  let a = 0, bi = 0;
  const n = text.length;
  while (a < n) {
    while (bi < breaks.length && breaks[bi] <= a) bi++;
    const limit = bi < breaks.length ? Math.min(n, breaks[bi]) : n;
    let b;
    if (limit - a <= CHUNK_MAX) b = limit;
    else {
      const lo = a + CHUNK_MIN, hi = a + CHUNK_MAX;
      let k = text.lastIndexOf('\n', hi);
      if (k < lo) { k = -1; for (let j = hi; j >= lo; j--) if ('.!?'.includes(text[j]) && text[j + 1] === ' ') { k = j + 1; break; } }
      if (k < lo) k = text.lastIndexOf(' ', hi);
      b = k >= lo ? k + 1 : hi;
    }
    out.push([a, b]);
    a = b;
  }
  return out;
}

async function readFlow(job, book, sink) {
  const sections = book.sections || [];
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  const before = [];
  sizes.reduce((acc, x, i) => { before[i] = acc; return acc + x; }, 0);
  const sectionOf = (id) => (typeof id === 'number' ? id : sections.findIndex((s) => s.id === id));
  // contents and page-list entries per section: { frag, label, kind }
  const anchors = new Map();
  const note = async (items, kind) => {
    for (const it of items) {
      let parts = null;
      try { parts = await book.splitTOCHref?.(it.href); } catch {}
      const s = sectionOf(parts?.[0]);
      if (!(s >= 0)) continue;
      if (!anchors.has(s)) anchors.set(s, []);
      anchors.get(s).push({ frag: parts?.[1] ?? null, label: label(it.label), kind });
    }
  };
  await note(flattenToc(book.toc), 'toc');
  await note(book.pageList || [], 'page');
  const hasPages = (book.pageList || []).length > 0;
  let chapter = null, page = null, u = 0;
  for (let s = 0; s < sections.length; s++) {
    await pass(job);
    const sec = sections[s];
    if (typeof sec.createDocument !== 'function') continue;
    let doc = null;
    try { doc = await sec.createDocument(); } catch (e) { console.warn('[fulltext] section failed', job.name, s, e?.message); }
    const root = doc?.body || doc?.documentElement;
    const here = anchors.get(s) || [];
    // the anchor elements of this section, found the way the reader finds them (a chapter often starts a page)
    const marks = new Map();
    for (const a of here) {
      let el = null;
      try { el = a.frag == null ? root : book.getTOCFragment?.(doc, a.frag); } catch {}
      if (el) { if (!marks.has(el)) marks.set(el, []); marks.get(el).push(a); }
    }
    const dt = domPieces(root, marks);
    const cl = cleanText(dt.pieces, { map: true });
    const placed = here.map((a) => ({ ...a, raw: dt.marked.has(a) ? dt.marked.get(a) : (a.frag == null ? 0 : null) })).filter((a) => a.raw != null).sort((x, y) => x.raw - y.raw);
    // cleaned position of a raw one (the first character at or after it)
    const cleanAt = (raw) => { let lo = 0, hi = cl.src.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cl.src[m] < raw) lo = m + 1; else hi = m; } return lo; };
    const breaks = placed.filter((a) => a.kind === 'page').map((a) => cleanAt(a.raw)).filter((x) => x > 0 && x < cl.text.length);
    let ai = 0;
    for (const [a, b] of chunks(cl.text, breaks)) {
      const text = cl.text.slice(a, b).trim();
      const rawStart = cl.src[a] ?? 0, rawEnd = (cl.src[b - 1] ?? rawStart) + 1;
      while (ai < placed.length && placed[ai].raw <= rawStart) { if (placed[ai].kind === 'toc') chapter = placed[ai].label; else page = placed[ai].label; ai++; }
      if (!letterCount(text)) continue;
      const frac = dt.length ? rawStart / dt.length : 0;
      const pos = Math.floor((before[s] + frac * sizes[s]) / LOC_SIZE) + 1;
      await sink.add({ u: u++, text, terms: indexTerms(text), s, o: rawStart, len: rawEnd - rawStart, page: hasPages ? page : null, pos, chapter });
      if (job.aborted) throw ABORT;
    }
    // anchors after the last chunk (an empty page at the end of a section) still count for the next section
    for (; ai < placed.length; ai++) { if (placed[ai].kind === 'toc') chapter = placed[ai].label; else page = placed[ai].label; }
  }
  sink.units = u;
  await sink.flush(u);
  return u;
}

async function readFoliate(job, sink) {
  const { makeBook } = await getFoliate();
  const book = await makeBook(job.url);
  try { return await readFlow(job, book, sink); }
  finally { try { book.destroy?.(); } catch {} }
}

/** TXT, Markdown, HTML, DOCX, RTF: the text the reader gets (library:readText), made into sections by text-book.js. */
async function readText(job, sink, api) {
  let src = await api.fulltextSource(job.id);
  if (!src) throw new Error('no text');
  if (job.format === 'html' && src.text != null && src.html == null) src = { html: src.text };
  const book = makeTextBook(src, { title: job.title, author: job.author, language: job.language, format: job.format });
  try { return await readFlow(job, book, sink); }
  finally { try { book.destroy?.(); } catch {} }
}

let running = null;
async function run(job, api) {
  running = job;
  const sink = new Sink(api, job);
  let result;
  try {
    let units;
    if (job.format === 'pdf') units = await readPdf(job, sink);
    else if (FOLIATE.has(job.format)) units = await readFoliate(job, sink);
    else units = await readText(job, sink, api);
    result = { state: 'done', units };
  } catch (e) {
    if (e === ABORT || job.aborted) { if (running === job) running = null; return; }
    console.warn('[fulltext] book failed', job.name, e?.message);
    result = { state: 'error', error: String(e?.message || e), units: sink.units || null };
  }
  if (running === job) running = null;
  await api.fulltextEnd(job.jobId, result);
  // the pages of the book are garbage now: collect them before the next book
  setTimeout(() => api.fulltextCollect?.(), 0);
}

/** Connects the indexer window to the main process (window.indexerApi, electron/preload-indexer.js). */
export function initFulltext(api) {
  if (!api?.onFulltextJob) return;
  api.onFulltextGate((open) => setGate(open));
  // an aborted job may wait at the closed gate: wake it, it ends at once (the others go back to waiting)
  api.onFulltextAbort((jobId) => { if (running && running.jobId === jobId) { running.aborted = true; const w = waiters; waiters = []; for (const fn of w) fn(); } });
  api.onFulltextJob((job) => {
    if (running) running.aborted = true;    // a new job replaces one the main process gave up
    run(job, api);
  });
  api.fulltextHello?.();
}
