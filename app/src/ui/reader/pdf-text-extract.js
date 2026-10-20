// The raw material of the text view of a PDF (pdf-text-view.js): what pdf.js knows about a page, reduced to plain data.
//   items    the text items in page points (top-left origin), with the style of their font: bold and italic come from
//            the font name ("Minion-BoldIt", "Times-Italic"), a slanted text matrix or the font flags
//   images   the raster pictures painted on the page (photos, scans, diagrams as images), clipped to what is visible
//   paths    the painted vector paths (rules, charts, diagrams drawn with lines), clipped as well
// extractPage() only reads (text content and operator list, no rendering) and also runs in Node for the fixtures of
// the tests (build/testlib/dump_reader_fixtures.mjs). renderRegion() draws a part of a page into a picture (browser).

const round = (v) => Math.round(v * 100) / 100;
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
/** axis-aligned box of the rectangle [x0, y0, x1, y1] under the matrix m */
function boxOf(m, x0, y0, x1, y1) {
  const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function intersect(a, b) {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
}

/** Bold, italic and monospace from a font name as producers write them ("ABCDEF+Garamond-BoldItalic", "Arial,Bold"). */
export function fontStyle(name = '', flags = {}) {
  const n = String(name).replace(/^[A-Z]{6}\+/, '');
  const bold = !!flags.bold || /bold|black|heavy|semibold|demibold|extrabold|ultrabold|[-,_ ](?:bd|sb|eb|hv)(?:it|i)?$|-(?:b|db)$/i.test(n) || /(?:^|[-, ])(?:Semi|Demi)?Bold/i.test(n);
  const italic = !!flags.italic || /italic|ital$|oblique|kursiv|slanted|inclined|[-,_ ](?:it|i|bi|bdit|sbit|ebit)$/i.test(n);
  const mono = /mono|courier|consol|typewriter|code|fixed|cmtt|lmmono/i.test(n);
  return { bold, italic, mono };
}

/**
 * The raw data of one page.
 * @param {object} pdf  a pdf.js PDFDocumentProxy
 * @param {number} index  page index (0-based)
 * @param {{ OPS?: object, Util?: object }} [lib]  pdfjsLib (globalThis.pdfjsLib by default)
 * @returns {Promise<{ index, w, h, items, fonts, images, paths, ocrMode }>}
 */
export async function extractPage(pdf, index, lib = globalThis.pdfjsLib) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const VT = Array.from(vp.transform);
  // the operator list first: it sends the fonts of the page to this thread (their names), then the text
  const ops = await page.getOperatorList().catch(() => null);
  const tc = await page.getTextContent();
  const fonts = [], fontIndex = new Map();
  const fontOf = (loaded) => {
    if (fontIndex.has(loaded)) return fontIndex.get(loaded);
    let f = null;
    try { f = page.commonObjs.has(loaded) ? page.commonObjs.get(loaded) : null; } catch { f = null; }
    const style = tc.styles?.[loaded] || {};
    const name = f?.name || '';
    const st = fontStyle(name, { bold: f?.bold || f?.black, italic: f?.italic });
    const k = fonts.length;
    fonts.push({ name: name.replace(/^[A-Z]{6}\+/, '').slice(0, 60), bold: st.bold, italic: st.italic, mono: st.mono || style.fontFamily === 'monospace', serif: style.fontFamily === 'serif', ascent: Number.isFinite(style.ascent) ? round(style.ascent) : 0.8 });
    fontIndex.set(loaded, k);
    return k;
  };
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const tx = mul(VT, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (!(size > 0.5)) continue;
    const angle = Math.atan2(tx[1], tx[0]) * 180 / Math.PI;
    const f = fontOf(it.fontName);
    const ascent = fonts[f].ascent > 0.3 && fonts[f].ascent < 1.3 ? fonts[f].ascent : 0.8;
    // a text matrix with a skew is an italic made by the producer
    const skew = Math.abs(angle) < 1 && Math.abs(tx[2] / (tx[3] || 1)) > 0.12;
    const width = it.width * (Math.hypot(tx[0], tx[1]) / (Math.hypot(it.transform[0], it.transform[1]) || 1));
    items.push({ s: it.str, x: round(tx[4]), y: round(tx[5] - ascent * size), w: round(Math.abs(width)), h: round(size), b: round(tx[5]), f, ...(Math.abs(angle) > 1 ? { r: Math.round(angle) } : {}), ...(skew ? { sk: 1 } : {}) });
  }
  const res = { index, w: round(vp.width), h: round(vp.height), items, fonts, images: [], paths: [], invisible: 0 };
  if (ops) graphics(ops, VT, res, lib, { w: vp.width, h: vp.height });
  try { page.cleanup(); } catch { /* a render of the page view is still running */ }
  return res;
}

/** Raster pictures and painted paths of an operator list, in page points, clipped. */
function graphics(list, VT, res, lib, pageBox) {
  const OPS = lib?.OPS;
  if (!OPS || !list?.fnArray) return;
  const PAINT = new Set([OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((v) => v != null));
  const STROKE = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((v) => v != null));
  const page = { x: 0, y: 0, w: pageBox.w, h: pageBox.h };
  let ctm = VT, clip = page, pendingClip = false, lineWidth = 1, textMode = 0;
  const stack = [];
  const { fnArray, argsArray } = list;
  const addImage = (box, kind) => {
    const r = intersect(intersect(box, clip), page);
    if (r.w >= 4 && r.h >= 4) res.images.push({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h), ...(kind ? { k: kind } : {}) });
  };
  for (let i = 0; i < fnArray.length && res.images.length < 400 && res.paths.length < 6000; i++) {
    const fn = fnArray[i], a = argsArray[i];
    switch (fn) {
      case OPS.save: case OPS.beginGroup: stack.push([ctm, clip, lineWidth]); break;
      case OPS.restore: case OPS.endGroup: case OPS.paintFormXObjectEnd: case OPS.endAnnotation: {
        const s = stack.pop(); if (s) [ctm, clip, lineWidth] = s; break;
      }
      case OPS.transform: if (a) ctm = mul(ctm, a); break;
      case OPS.paintFormXObjectBegin:
        stack.push([ctm, clip, lineWidth]);
        if (a?.[0]) ctm = mul(ctm, Array.from(a[0]));
        if (a?.[1]) { const bb = a[1]; clip = intersect(boxOf(ctm, bb[0], bb[1], bb[2], bb[3]), clip); }
        break;
      case OPS.beginAnnotation:
        stack.push([ctm, clip, lineWidth]);
        if (a?.[2]) ctm = mul(ctm, Array.from(a[2]));
        if (a?.[3]) ctm = mul(ctm, Array.from(a[3]));
        break;
      case OPS.setLineWidth: lineWidth = a?.[0] ?? lineWidth; break;
      case OPS.setTextRenderingMode: textMode = a?.[0] ?? 0; if (textMode === 3) res.invisible++; break;
      case OPS.clip: case OPS.eoClip: pendingClip = true; break;
      case OPS.constructPath: {
        // [paint op, [path], minMax] in user space
        const op = a?.[0], mm = a?.[2];
        if (!mm || !(mm[2] >= mm[0])) { pendingClip = false; break; }
        let box = boxOf(ctm, mm[0], mm[1], mm[2], mm[3]);
        if (pendingClip) { clip = intersect(box, clip); pendingClip = false; }
        if (!PAINT.has(op)) break;
        if (STROKE.has(op)) {
          // a stroked line has the width of the pen
          const lw = Math.max(0.5, lineWidth * Math.hypot(ctm[0], ctm[1]));
          box = { x: box.x - lw / 2, y: box.y - lw / 2, w: box.w + lw, h: box.h + lw };
        }
        const r = intersect(box, intersect(clip, page));
        if (r.w <= 0 || r.h <= 0) break;
        res.paths.push({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h), ...(STROKE.has(op) ? { s: 1 } : {}) });
        break;
      }
      case OPS.shadingFill: addImage(clip, 'shading'); break;
      case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageMaskXObject:
        addImage(boxOf(ctm, 0, 0, 1, 1), fn === OPS.paintImageMaskXObject ? 'mask' : null); break;
      case OPS.paintImageXObjectRepeat: case OPS.paintImageMaskXObjectRepeat: {
        if (!a) break;
        const [, sx, sy, pos] = a;
        for (let j = 0; pos && j + 1 < pos.length && j < 400; j += 2) addImage(boxOf(mul(ctm, [sx, 0, 0, sy, pos[j], pos[j + 1]]), 0, 0, 1, 1), 'mask');
        break;
      }
      default: break;
    }
  }
}

/**
 * Draws the rectangle `rect` (page points) of a page at `scale` pixels per point into a canvas and returns it.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderRegion(pdf, index, rect, scale) {
  const page = await pdf.getPage(index + 1);
  const w = Math.max(1, Math.round(rect.w * scale)), h = Math.max(1, Math.round(rect.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const viewport = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}
