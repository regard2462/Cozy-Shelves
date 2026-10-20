// What the indexer reads out of a book: metadata, the cover (or a title card), the page count and a text sample.
// foliate-js for EPUB/MOBI/AZW3/FB2/CBZ, pdf.js for PDF, the DOM for HTML and Markdown. Shared by the hidden indexer
// window of the desktop (app/src/indexer.js, the book comes as a book:// URL) and the browser version
// (app/src/web/web-library.js, the book comes as a File). Also decodes and measures pictures for the cover search.
import { makeTypographicCover, averageColor } from './cover-art.js';
import { pageStats, coverBox, gridOf, trimBox } from '../../../electron/library/cover-match.js';

// app/vendor/foliate-js/ next to the page (index.html, indexer.html and the web build share the layout)
const VENDOR = new URL('vendor/foliate-js/', document.baseURI).href;
export const FOLIATE_FORMATS = ['epub', 'mobi', 'azw3', 'fb2', 'fbz', 'cbz'];

let foliate, pdfjs;
export async function getFoliate() {
  if (!foliate) foliate = await import(/* @vite-ignore */ VENDOR + 'view.js');
  return foliate;
}
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(/* @vite-ignore */ VENDOR + 'vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = VENDOR + 'vendor/pdfjs/pdf.worker.mjs';
  }
  return pdfjs;
}

const str = (x) => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return x.map(str).filter(Boolean).join(', ');
  if (typeof x === 'object') return str(x.name ?? Object.values(x)[0]);
  return String(x);
};
const log = (...a) => { try { const el = document.getElementById('log'); if (el) el.textContent = (a.join(' ') + '\n' + el.textContent).slice(0, 5000); } catch {} };

async function blobToJpeg(blob, maxH = 900) {
  let bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) {
    // SVG covers (or unusual encodings): decode through an <img>
    bmp = await new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth || 600; c.height = img.naturalHeight || 900; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
    if (!bmp) return null;
  }
  const scale = Math.min(1, maxH / bmp.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const color = averageColor(ctx, c.width, c.height);
  return { dataUrl: c.toDataURL('image/jpeg', 0.86), color, stats: statsOf(c) };
}

/** A small RGBA copy of a picture (canvas or bitmap) for measuring it: at most `maxH` px tall. */
function smallPixels(src, w, h, maxH = 200) {
  const s = Math.min(1, maxH / h);
  const sw = Math.max(1, Math.round(w * s)), sh = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas'); c.width = sw; c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, sw, sh);
  return { data: ctx.getImageData(0, 0, sw, sh).data, w: sw, h: sh };
}
/** What page 1 looks like (blank, plain text, a picture …): see cover-match.js pageStats and weakKind. */
function statsOf(canvas) {
  try { const p = smallPixels(canvas, canvas.width, canvas.height); return pageStats(p.data, p.w, p.h); } catch { return null; }
}

/** The book as foliate-js wants it: the File itself, or the URL the desktop serves it under. */
const bookSource = (job) => job.file || job.url;

async function indexFoliate(job) {
  const { makeBook } = await getFoliate();
  const book = await makeBook(bookSource(job));
  const m = book.metadata || {};
  const ids = [].concat(m.identifier || []).map(str);
  const isbn = ids.find((i) => /isbn/i.test(i) || /^\d{13}$|^\d{9}[\dX]$/.test(i.replace(/-/g, ''))) || null;
  const metadata = {
    title: str(m.title), author: str(m.author || m.creator), language: str(m.language).slice(0, 5), publisher: str(m.publisher),
    year: (str(m.published) || '').match(/\d{4}/)?.[0] ? parseInt(str(m.published).match(/\d{4}/)[0]) : null,
    subjects: [].concat(m.subject || []).map(str).filter(Boolean), description: stripHtml(str(m.description)), isbn,
  };
  // the series of an EPUB (calibre:series or EPUB 3 belongs-to-collection): the shelves sort volumes by it
  const series = [].concat(m.belongsTo?.series || [])[0];
  if (str(series?.name)) { metadata.series = str(series.name); metadata.seriesIndex = Number.isFinite(+series.position) ? +series.position : null; }
  let cover = null;
  try { const blob = await book.getCover?.(); if (blob) cover = await blobToJpeg(blob); } catch (e) { log('cover failed', e.message); }
  // text sample from the first linear sections
  let text = '';
  const sections = (book.sections || []).filter((s) => s.linear !== 'no');
  for (const s of sections.slice(0, 6)) {
    if (text.length > 16000) break;
    try {
      if (s.createDocument) { const doc = await s.createDocument(); text += ' ' + (doc.body?.textContent || doc.documentElement?.textContent || ''); }
    } catch (e) { /* ignore */ }
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 16000);
  const pageCount = book.pageList?.length || (book.sections ? Math.round(book.sections.reduce((a, s) => a + (s.size || 0), 0) / 1800) : null);
  if (!cover) cover = await makeTypographicCover(metadata.title || job.name, metadata.author, job.id);
  book.destroy?.();
  return { metadata, pageCount, textSample: text, cover: cover?.dataUrl || null, coverColor: cover?.color || null, coverGenerated: !!cover?.generated, coverStats: cover?.stats || null };
}

async function indexPdf(job) {
  const lib = await getPdfjs();
  const src = job.file ? { data: new Uint8Array(await job.file.arrayBuffer()) } : { url: job.url, disableAutoFetch: true, disableStream: false };
  const task = lib.getDocument({ ...src, cMapUrl: VENDOR + 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'vendor/pdfjs/standard_fonts/' });
  const pdf = await task.promise;
  const meta = await pdf.getMetadata().catch(() => ({ info: {} }));
  const info = meta.info || {};
  const md = meta.metadata;
  const dcTitle = md?.get?.('dc:title') || null;
  const metadata = {
    title: str(dcTitle) || str(info.Title), author: str(info.Author), language: str(info.Language).slice(0, 5), publisher: str(info.Producer && info.Creator ? '' : ''),
    year: (str(info.CreationDate) || '').match(/D:(\d{4})/)?.[1] ? parseInt(str(info.CreationDate).match(/D:(\d{4})/)[1]) : null,
    subjects: str(info.Keywords).split(/[,;]/).map((s) => s.trim()).filter(Boolean), description: str(info.Subject), isbn: null,
  };
  if (/^(untitled|microsoft word|\.?doc|\w+\.(docx?|indd|qxd|pdf|tex))/i.test(metadata.title)) metadata.title = '';
  // cover: page 1
  let cover = null;
  try {
    const page = await pdf.getPage(1);
    const vp0 = page.getViewport({ scale: 1 });
    const scale = 900 / vp0.height;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    cover = { dataUrl: c.toDataURL('image/jpeg', 0.86), color: averageColor(ctx, c.width, c.height), stats: statsOf(c) };
    page.cleanup();
  } catch (e) { log('pdf cover failed', e.message); }
  // text sample: first 8 pages
  let text = '';
  const n = Math.min(pdf.numPages, 8);
  for (let i = 1; i <= n; i++) {
    try { const page = await pdf.getPage(i); const tc = await page.getTextContent(); text += ' ' + tc.items.map((it) => it.str).join(' '); page.cleanup(); } catch {}
    if (text.length > 16000) break;
  }
  text = text.replace(/\s+/g, ' ').trim().slice(0, 16000);
  const pageCount = pdf.numPages;
  await pdf.destroy();
  if (!cover) cover = await makeTypographicCover(metadata.title || job.name, metadata.author, job.id);
  return { metadata, pageCount, textSample: text, cover: cover?.dataUrl || null, coverColor: cover?.color || null, coverGenerated: !!cover?.generated, coverStats: cover?.stats || null };
}

async function indexText(job) {
  // DOCX and RTF cannot be read here: the main process adds their text and metadata (electron/library/textformats.js)
  let text = '';
  if (job.format !== 'docx' && job.format !== 'rtf') {
    try {
      if (job.file) text = await job.file.text();
      else { const res = await fetch(job.url); if (res.ok) text = await res.text(); }
    } catch {}
  }
  const metadata = { title: '', author: '', language: '', publisher: '', year: null, subjects: [], description: '', isbn: null };
  if (job.format === 'html') {
    const doc = parseHtml(text);
    metadata.title = clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || doc.querySelector('h1')?.textContent);
    metadata.author = clean(doc.querySelector('meta[name="author"]')?.getAttribute('content'));
    metadata.language = clean(doc.documentElement.getAttribute('lang')).slice(0, 5);
    metadata.description = clean(doc.querySelector('meta[name="description"]')?.getAttribute('content'));
    text = bodyText(doc);
  } else if (job.format === 'md') {
    metadata.title = (text.split('\n').map((l) => l.trim()).find((l) => /^#\s+\S/.test(l)) || '').replace(/^#+\s*/, '').slice(0, 200);
  }
  const cover = await makeTypographicCover(metadata.title || job.name.replace(/\.[^.]+$/, ''), metadata.author, job.id);
  return { metadata, pageCount: text ? Math.max(1, Math.round(text.length / 1800)) : null, textSample: text.replace(/\s+/g, ' ').trim().slice(0, 16000), cover: cover.dataUrl, coverColor: cover.color, coverGenerated: true };
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** Book HTML is parsed inertly: no script runs and no image is fetched while indexing. */
function parseHtml(s) { return new DOMParser().parseFromString(String(s || ''), 'text/html'); }
function bodyText(doc) {
  for (const el of doc.querySelectorAll('script, style, noscript, template')) el.remove();
  return clean(doc.body?.textContent || '');
}
function stripHtml(s) { return s ? bodyText(parseHtml(s)) : ''; }

/**
 * Indexes one book. job: { id, name, format, size, url? (book://…, the desktop) | file? (a File, the browser) }.
 * @returns { metadata, pageCount, textSample, cover (data URL), coverColor, coverGenerated, coverStats } or, when the
 * book cannot be read, { error, cover (the title card), coverColor, coverGenerated: true, metadata: {} }
 */
export async function indexBook(job) {
  try {
    if (job.format === 'pdf') return await indexPdf(job);
    if (FOLIATE_FORMATS.includes(job.format)) return await indexFoliate(job);
    return await indexText(job);
  } catch (e) {
    log('failed', job.name, e.message);
    let cover = null;
    try { cover = await makeTypographicCover(String(job.name || '').replace(/\.[^.]+$/, ''), '', job.id); } catch {}
    return { error: e.message, cover: cover?.dataUrl || null, coverColor: cover?.color || null, coverGenerated: !!cover, metadata: {} };
  }
}

// ---------------------------------------------------------------- image jobs ----------------------------------------
/**
 * Decodes one picture (bytes from the internet, or a cover:// address) and measures it:
 *   stats   → what it looks like (cover-match.js pageStats, for the check of page 1)
 *   grid    → the cover without a frame of its own colour (coverBox), its proportions and a 32 × 32 colour grid
 *             (the input of the fingerprints)
 *   preview → a small JPEG of the content (the choice in the book info card), this many pixels tall
 *   jpeg    → the content as the stored cover, at most this many pixels tall, with its average colour
 */
export async function imageJob(job) {
  const blob = job.bytes ? new Blob([job.bytes]) : await fetch(job.url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
  const bmp = await decodePicture(blob);
  if (!bmp) return { ok: false, error: 'undecodable' };
  try {
    const W = bmp.width, H = bmp.height;
    const out = { ok: true, width: W, height: H };
    const small = smallPixels(bmp, W, H);
    if (job.stats) out.stats = pageStats(small.data, small.w, small.h);
    if (job.grid || job.preview || job.jpeg) {
      const ring = trimBox(small.data, small.w, small.h);
      const box = coverBox(small.data, small.w, small.h, ring);
      const sx = W / small.w, sy = H / small.h;
      const crop = { x: Math.round(box.x0 * sx), y: Math.round(box.y0 * sy), w: Math.max(1, Math.round((box.x1 - box.x0) * sx)), h: Math.max(1, Math.round((box.y1 - box.y0) * sy)) };
      out.aspect = crop.w / crop.h; out.boxHeight = crop.h; out.trimmed = !!box.trimmed;
      // the picture lies on a white or light grey ground (a 3D mock-up of the book, a photo on white): a doubtful cover
      // (web-covers.js tries another one first); a cover in a frame of its own colour is no such thing
      const c = ring.color || [0, 0, 0];
      out.framed = !!ring.trimmed && 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] >= 225 && Math.max(...c) - Math.min(...c) <= 24;
      if (job.grid) out.grid = gridOf(small.data, small.w, small.h, box);
      if (job.preview) out.preview = cropToJpeg(bmp, crop, job.preview, 0.8).dataUrl;
      if (job.jpeg) { const j = cropToJpeg(bmp, crop, job.jpeg, 0.88); Object.assign(out, { jpeg: j.dataUrl, color: j.color, jpegWidth: j.w, jpegHeight: j.h }); }
    }
    return out;
  } finally { bmp.close?.(); }
}
async function decodePicture(blob) {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (bmp) return bmp;
  // SVG and unusual encodings: through an <img>
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth || 600; c.height = img.naturalHeight || 900; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
function cropToJpeg(src, crop, maxH, quality) {
  const s = Math.min(1, maxH / crop.h);
  const w = Math.max(1, Math.round(crop.w * s)), h = Math.max(1, Math.round(crop.h * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  // a canvas in main memory: reading it back (colour, JPEG) never waits for the graphics card, which the room in the
  // main window needs for its frames while "Alle Cover jetzt laden" goes through hundreds of pictures
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);          // a transparent picture on white
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  return { dataUrl: c.toDataURL('image/jpeg', quality), color: averageColor(ctx, w, h), w, h };
}
