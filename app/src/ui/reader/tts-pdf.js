// The text of a PDF page for read-aloud. pdf.js puts the text of a page into its text layer as one <span> per text
// item, with a <br> after the last item of a line and nothing between the items. Read as one string, the words at the
// line ends run together ("die" + "Gedanken" → "dieGedanken"), a heading runs into the first sentence, two columns
// written line by line come out interleaved, running heads and page numbers are read on every page, and a diagram set
// in a chess font is read letter by letter. Here the page is put together again from the positions of the items:
// lines from the baselines, columns and blocks with an XY cut, paragraphs from the line spacing, words joined at
// hyphenated line ends, running heads, page numbers and junk lines left out. Every sentence keeps its DOM range for
// the highlight.
//
// assemblePage() is pure (positions in, paragraphs out) and tested in Node (electron/tts/test-reading.js);
// collectPdfPage() reads a page document of the reader.
import { splitSentences } from './tts-lang.js';
import { inspectText } from './tts-junk.js';
import { isChessToken } from './tts-chess.js';

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
/** The font size of the text of a page: the size that carries the most characters (headings and notes are few). */
function bodySize(items) {
  const weight = new Map();
  for (const it of items) { const k = Math.round((it.size || it.h || 0) * 2) / 2; if (k > 0) weight.set(k, (weight.get(k) || 0) + String(it.text || '').trim().length); }
  return [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
}
const NO_SPACE_AFTER = /[\s­(\[„“‚‘«‹/-]$/;
const NO_SPACE_BEFORE = /^[\s,.;:!?)\]”’»›%/]/;
const PAGE_NUMBER = /^(?:[-–—·•|]?\s*)?(?:seite|page|s\.|p\.)?\s*(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:\/|von|of)\s*\d{1,4})?(?:\s*[-–—·•|])?$/i;
// words after a hyphen that keep it ("Ein- und Ausgang", "be- oder entlasten")
const HYPHEN_KEEP = /^(?:und|oder|bis|sowie|bzw\.?|beziehungsweise|als|wie|noch|and|or|nor|to)\b/;

/** Normalised form of a running head or a page number, to recognise it on the next pages ("Kapitel 3 · 12" → "kapitel # · #"). */
export const headKey = (t) => String(t || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

/**
 * Lines (one baseline, no wide gap) from text items. items: [{ text, x, y, w, h, size, rot }] with y = top edge and
 * size = font height, all in the same unit (page pixels). A wide gap on one baseline (more than 1.2 font heights)
 * starts another segment: a column, a table cell, a page number beside a running head.
 */
export function buildLines(items) {
  const body = bodySize(items);
  // footnote markers and other small raised digits belong to no line of their own
  const usable = items.filter((it) => it.text && it.text.trim() && !(Math.abs(it.rot || 0) > 1)
    && !((it.size || it.h) < body * 0.72 && /^[\d*†‡§¹²³⁴-⁹,\s]+$/.test(it.text.trim())));
  const sorted = usable.map((it, k) => ({ ...it, k, size: it.size || it.h, base: it.y + it.h })).sort((a, b) => a.base - b.base || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.base - it.base) < Math.min(r.size, it.size) * 0.45);
    if (row) { row.items.push(it); row.size = Math.max(row.size, it.size); }
    else rows.push({ base: it.base, size: it.size, items: [it] });
  }
  const lines = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of r.items) {
      const gap = cur ? it.x - cur.x1 : 0;
      if (!cur || gap > 1.2 * Math.max(it.size, cur.size)) {
        cur = { items: [], x0: it.x, x1: it.x + it.w, top: it.y, bottom: it.y + it.h, base: r.base, size: it.size };
        lines.push(cur);
      }
      cur.items.push(it);
      cur.x1 = Math.max(cur.x1, it.x + it.w); cur.top = Math.min(cur.top, it.y); cur.bottom = Math.max(cur.bottom, it.y + it.h);
      cur.size = Math.max(cur.size, it.size);
    }
  }
  return lines;
}

/** Covered intervals of [a, b) ranges, merged. */
function cover(ranges) {
  const s = [...ranges].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of s) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}

/**
 * Reading order of lines with a recursive XY cut: columns side by side first (a wide gap in x through all lines of
 * the region, both sides real text columns), else the widest gap in y. Returns blocks of lines, each block sorted by
 * baseline and x.
 */
export function readingOrder(lines, body) {
  const blocks = [];
  const walk = (set, depth) => {
    if (set.length <= 1 || depth > 24) { if (set.length) blocks.push(set); return; }
    // columns: a gap in x through the whole region
    const xs = cover(set.map((l) => [l.x0, l.x1]));
    let best = null;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i][0] - xs[i - 1][1];
      if (gap < 0.6 * body) continue;
      const left = set.filter((l) => l.x1 <= xs[i - 1][1] + 0.01), right = set.filter((l) => l.x0 >= xs[i][0] - 0.01);
      if (left.length < 2 || right.length < 2) continue;
      const wide = (side) => median(side.map((l) => l.x1 - l.x0)) >= 5 * body;
      const span = (side) => [Math.min(...side.map((l) => l.top)), Math.max(...side.map((l) => l.bottom))];
      const [lt, lb] = span(left), [rt, rb] = span(right);
      const overlap = Math.min(lb, rb) - Math.max(lt, rt);
      if (!wide(left) || !wide(right) || overlap < 0.3 * Math.min(lb - lt, rb - rt)) continue;
      if (!best || gap > best.gap) best = { gap, left, right };
    }
    if (best) { walk(best.left, depth + 1); walk(best.right, depth + 1); return; }
    // blocks: the widest gap in y (more than a normal line spacing)
    const ys = cover(set.map((l) => [l.top, l.bottom]));
    let cut = null;
    for (let i = 1; i < ys.length; i++) {
      const gap = ys[i][0] - ys[i - 1][1];
      if (gap > 0.9 * body && (!cut || gap > cut.gap)) cut = { gap, at: ys[i][0] };
    }
    if (cut) { walk(set.filter((l) => l.top < cut.at), depth + 1); walk(set.filter((l) => l.top >= cut.at), depth + 1); return; }
    blocks.push([...set].sort((a, b) => a.base - b.base || a.x0 - b.x0));
  };
  walk(lines, 0);
  return blocks;
}

/** The text of a line with the positions of its items: [{ text, parts: [{ item, from, to, at }] }] */
function lineText(line) {
  let text = '';
  const parts = [];
  for (const it of line.items) {
    const t = it.text;
    if (text && !NO_SPACE_AFTER.test(text) && !NO_SPACE_BEFORE.test(t)) {
      const prev = line.items[line.items.indexOf(it) - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : 0;
      if (gap > 0.12 * it.size) text += ' ';
    }
    parts.push({ item: it, from: 0, to: t.length, at: text.length });
    text += t;
  }
  return { text, parts };
}

/**
 * Paragraphs of a page in reading order. Running heads and page numbers at the top or bottom are left out (smaller
 * than the text, set apart from it, only a number, the book title, or seen on the pages before), and so are lines of
 * junk (the rows of a diagram font). Each paragraph keeps the positions of its text in the items for the ranges.
 * @param {object[]} items  see buildLines
 * @param {{ width: number, height: number }} page
 * @param {{ title?: string, heads?: Set<string> }} [opts]  heads: headKey() of running heads seen on other pages
 * @returns {{ paragraphs: { text: string, parts: object[], size: number }[], heads: string[], dropped: string[] }}
 */
export function assemblePage(items, page, opts = {}) {
  let lines = buildLines(items);
  const body = bodySize(lines.flatMap((l) => l.items));
  const pitch = median(lines.map((l) => l.bottom - l.top)) || body;
  const heads = [], dropped = [];
  const title = headKey(opts.title || '');
  const seen = opts.heads || new Set();
  // running heads and page numbers: short lines in the top and bottom margins, before the reading order is worked
  // out (a page number in the middle of the foot would otherwise stand in the gap between two columns)
  const isMargin = (line, top, rest) => {
    const t = lineText(line).text.trim();
    // short: a running head or a page number; the long lines of a footnote are read
    if (!t || (t.length > 80 && !PAGE_NUMBER.test(t))) return false;
    if (top ? line.bottom > page.height * 0.12 : line.top < page.height * 0.88) return false;
    // a heading is larger than the text, a running head never is
    if (line.size > body * 1.1) return false;
    const k = headKey(t);
    const near = rest.length ? Math.min(...rest.map((l) => (top ? l.top - line.bottom : line.top - l.bottom))) : 0;
    return PAGE_NUMBER.test(t) || seen.has(k) || (title && k === title) || line.size < body * 0.93 || near > 2.2 * pitch;
  };
  for (const top of [true, false]) {
    for (let n = 0; n < 3 && lines.length > 1; n++) {
      const edge = top ? Math.min(...lines.map((l) => l.top)) : Math.max(...lines.map((l) => l.bottom));
      // every segment of the outermost row (a head on the left, the page number on the right)
      const row = lines.filter((l) => (top ? l.top - edge < 0.5 * l.size : edge - l.bottom < 0.5 * l.size));
      const rest = lines.filter((l) => !row.includes(l));
      if (!rest.length || !row.every((l) => isMargin(l, top, rest))) break;
      for (const l of row.sort((a, b) => a.x0 - b.x0)) { const t = lineText(l).text.trim(); heads.push(headKey(t)); dropped.push(t); }
      lines = rest;
    }
  }
  const kept = readingOrder(lines, body);
  const paragraphs = [];
  for (const block of kept) {
    let para = null;
    const x0 = Math.min(...block.map((l) => l.x0)), x1 = Math.max(...block.map((l) => l.x1));
    let prev = null;
    for (const line of block) {
      const lt = lineText(line);
      // the rows of a diagram font, a line of symbols: never read
      if (inspectText(lt.text).junk && !lt.text.split(/\s+/).some((w) => isChessToken(w))) { dropped.push(lt.text); continue; }
      const prevText = prev ? prev.text : '';
      const newPara = !para || !prev
        || line.top - prev.line.bottom > 0.55 * pitch                                  // more space than between lines
        || Math.abs(line.size - prev.line.size) > 0.15 * Math.max(line.size, prev.line.size)   // a heading
        || (line.x0 > x0 + 0.9 * line.size && prev.line.x1 > x1 - 2 * line.size)        // an indented first line
        || (/[.!?:]["”’»]?$/.test(prevText) && prev.line.x1 < x1 - 0.2 * (x1 - x0));   // the short last line of a paragraph
      if (newPara) { para = { text: '', parts: [], size: line.size }; paragraphs.push(para); }
      else joinLine(para, lt);
      if (newPara || !para.text) {
        for (const p of lt.parts) para.parts.push({ ...p, at: para.text.length + p.at });
        para.text += lt.text;
      }
      prev = { line, text: lt.text };
    }
  }
  return { paragraphs: paragraphs.filter((p) => p.text.trim()), heads, dropped };
}

/** Appends a line to a paragraph: a word hyphenated at the line end is joined, otherwise a space. */
function joinLine(para, lt) {
  const m = /(\p{L}{2,})[-­¬]$/u.exec(para.text);
  const next = lt.text.trimStart();
  if (m && /^\p{Ll}/u.test(next) && !HYPHEN_KEEP.test(next)) {
    // "Nach-" + "mittag" → "Nachmittag": the hyphen goes, the last part keeps its position for the ranges
    cut(para, para.text.length - 1);
  } else if (m && /^[\p{Lu}\d]/u.test(next) && para.text.endsWith('-')) {
    // "Schach-" + "Bundesliga": a real hyphen, no space
  } else if (!/\s$/.test(para.text)) para.text += ' ';
  for (const p of lt.parts) para.parts.push({ ...p, at: para.text.length + p.at });
  para.text += lt.text;
}
/** Removes the last character of the paragraph text (the hyphen at a line end) from the text and from its part. */
function cut(para, at) {
  para.text = para.text.slice(0, at);
  const last = para.parts[para.parts.length - 1];
  if (last && last.at + (last.to - last.from) > at) last.to = last.from + (at - last.at);
}

/**
 * Sentences of a paragraph with the positions of their first and last character in the items.
 * @returns {{ text: string, start: { item, offset }, end: { item, offset } }[]}
 */
export function paragraphSentences(para, lang = 'auto') {
  const out = [];
  let cursor = 0;
  for (const sent of splitSentences(para.text, lang)) {
    let at = para.text.indexOf(sent, cursor);
    if (at < 0) at = para.text.indexOf(sent.slice(0, 12), cursor);
    if (at < 0) { out.push({ text: sent, start: null, end: null }); continue; }
    const end = at + sent.length;
    cursor = end;
    out.push({ text: sent, start: locate(para, at, false), end: locate(para, end - 1, true) });
  }
  return out;
}
function locate(para, pos, last) {
  let best = null;
  for (const p of para.parts) {
    const len = p.to - p.from;
    if (pos >= p.at && pos < p.at + len) return { item: p.item, offset: p.from + (pos - p.at) + (last ? 1 : 0) };
    if (!last && p.at > pos && !best) best = { item: p.item, offset: p.from };
    if (last && p.at + len <= pos) best = { item: p.item, offset: p.to };
  }
  return best;
}

// --- the page document of the reader ------------------------------------------------------------------------------
/** Waits until pdf.js has filled the text layer of a page (or the time is up: a scan has no text at all). */
export async function textLayerReady(doc, timeout = 6000) {
  const t0 = performance.now();
  // the empty frame beside a single page of a spread has no text layer at all
  if (!doc?.querySelector?.('.textLayer')) return null;
  for (;;) {
    const layer = doc.querySelector('.textLayer');
    if (!layer) return null;
    if (layer.dataset.lesesaal === 'done' || (!layer.dataset.lesesaal && layer.querySelector('.endOfContent'))) return layer;
    if (performance.now() - t0 > timeout) return layer;
    await new Promise((r) => setTimeout(r, 60));
  }
}

/**
 * The sentences of a PDF page document with their ranges.
 * @param {Document} doc
 * @param {{ title?: string, heads?: Set<string>, lang?: string }} [opts]
 * @returns {Promise<{ paragraphs: { text, sentences: { text, range }[] }[], heads: string[], dropped: string[], junk: string|null, chars: number }>}
 *   junk: why the page has no readable text ('empty', 'chars', 'script', 'symbols', 'words', 'letters'), else null
 */
export async function collectPdfPage(doc, opts = {}) {
  const layer = await textLayerReady(doc);
  const res = { paragraphs: [], heads: [], dropped: [], junk: 'empty', chars: 0 };
  if (!layer) return res;
  const box = layer.getBoundingClientRect();
  const spans = [...layer.querySelectorAll('span')].filter((s) => !s.classList.contains('markedContent') && s.firstChild?.nodeType === 3 && s.firstChild.nodeValue);
  const items = [];
  for (const s of spans) {
    const r = s.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const rot = parseFloat(s.style.getPropertyValue('--rotate')) || 0;
    items.push({ text: s.firstChild.nodeValue, node: s.firstChild, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height, size: r.height, rot });
  }
  const all = items.map((it) => it.text).join(' ');
  res.chars = all.replace(/\s+/g, '').length;
  if (!res.chars) return res;
  const page = assemblePage(items, { width: box.width, height: box.height }, opts);
  res.heads = page.heads; res.dropped = page.dropped;
  const text = page.paragraphs.map((p) => p.text).join('\n');
  const verdict = inspectText(text || all);
  res.junk = !text.trim() ? (inspectText(all).reason || 'empty') : verdict.junk ? verdict.reason : null;
  if (res.junk) return res;
  for (const para of page.paragraphs) {
    const sentences = [];
    for (const s of paragraphSentences(para, opts.lang)) {
      let range = null;
      if (s.start && s.end) {
        try { range = doc.createRange(); range.setStart(s.start.item.node, Math.min(s.start.offset, s.start.item.node.length)); range.setEnd(s.end.item.node, Math.min(s.end.offset, s.end.item.node.length)); }
        catch { range = null; }
      }
      sentences.push({ text: s.text, range });
    }
    res.paragraphs.push({ text: para.text, sentences });
  }
  return res;
}
