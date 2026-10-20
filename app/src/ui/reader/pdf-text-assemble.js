// The text view of a PDF, part 1: a page put together again from the raw data of pdf-text-extract.js. A printed page
// knows nothing of paragraphs: pdf.js gives text items (a word, a line, a few letters) at positions, the pictures and the
// paths that were painted. Here they become the blocks of a reflowable text:
//   figures     raster pictures, clusters of painted paths (charts, diagrams, tables) and rows of a diagram font,
//               together with the labels around them; they stay pictures in the text (cut from the rendered page)
//   lines       items on one baseline; small raised items (footnote markers) stay with their line as superscripts
//   margins     running heads and page numbers at the top and the foot are left out
//   footnotes   the small lines at the foot of the text (below a short rule or starting with a marker)
//   order       columns and blocks in reading order (the XY cut of tts-pdf.js), the figures in their place
//   paragraphs  from the line spacing, the first-line indent and the short last line; headings from the size and the
//               weight; list items from their bullet or number; captions next to their figure; hyphenated words joined
// A page without usable text (a scan, a page whose font map gives junk) becomes one picture of the whole page.
// buildSection() turns the pages of a section into the HTML of a section document: paragraphs run on across the page
// breaks (an invisible marker per page keeps the place of every PDF page), footnotes follow the paragraph in which
// their page ends, figures keep their place. Everything here is pure (no DOM): tested in Node
// (app/src/ui/reader/__tests__/run.js).
import { readingOrder, headKey } from './tts-pdf.js';
import { inspectText } from './tts-junk.js';

export { headKey };

/** Bumped whenever the assembly changes what a section looks like: saved positions inside the text view (CFIs) of
 *  another version are not trusted (pdf-text-view.js). */
export const ASSEMBLY_VERSION = 1;

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const PAGE_NUMBER = /^(?:[-–—·•|]?\s*)?(?:seite|page|s\.|p\.)?\s*(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:\/|von|of)\s*\d{1,4})?(?:\s*[-–—·•|])?$/i;
const HYPHEN_KEEP = /^(?:und|oder|bis|sowie|bzw\.?|beziehungsweise|als|wie|noch|and|or|nor|to)\b/;
const BULLET = /^([•◦▪▫‣⁃●○■□▸►–—*·-])\s+(?=\S)/u;
const ENUM = /^((?:\d{1,3}|[a-z]|[ivxlc]{1,5})[.)]|\(\d{1,3}\)|\([a-z]\))\s+(?=\S)/i;
const CAPTION = /^(?:abb\.?|abbildung|bild|fig\.?|figure|tab\.?|tabelle|table|diagramm|diagram|grafik|graphic|chart|karte|map|foto|photo|tafel|plate|illustration|übersicht|schema)\s*[\dIVX]*[.:)]?\s/i;
const END_SENTENCE = /[.!?…]["'»”’)\]]*$/;
const END_CLOSED = /[.!?…:]["'»”’)\]]*$/;
const NO_SPACE_AFTER = /[\s\u00ad(\[„“‚‘«‹/-]$/;
const NO_SPACE_BEFORE = /^[\s,.;:!?)\]”’»›%/]/;

/** The font size that carries the most characters. */
function bodySizeOf(items) {
  const weight = new Map();
  for (const it of items) { const k = Math.round(it.h * 2) / 2; if (k > 0) weight.set(k, (weight.get(k) || 0) + it.s.trim().length); }
  return [...weight.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 10;
}

/** The document's body size from a few sample pages (raw data), the same whichever page is built first. */
export function documentBodySize(raws) {
  const all = raws.flatMap((r) => r.items.filter((it) => !it.r));
  return all.length ? bodySizeOf(all) : 10;
}

// ------------------------------------------------------------------------------------------------- a grid of boxes
/** Connected groups of boxes (touching within `pad` points), via a coarse grid. Returns [{ x, y, w, h, members }]. */
function clusters(boxes, W, H, pad = 5) {
  if (!boxes.length) return [];
  const cell = 3, cols = Math.ceil(W / cell) + 2, rows = Math.ceil(H / cell) + 2;
  const grid = new Int32Array(cols * rows).fill(-1);
  const parent = boxes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  boxes.forEach((b, i) => {
    const c0 = Math.max(0, Math.floor((b.x - pad) / cell)), c1 = Math.min(cols - 1, Math.floor((b.x + b.w + pad) / cell));
    const r0 = Math.max(0, Math.floor((b.y - pad) / cell)), r1 = Math.min(rows - 1, Math.floor((b.y + b.h + pad) / cell));
    // large boxes mark only their outline cells (a frame around a whole figure must not cost its area)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r !== r0 && r !== r1 && c !== c0 && c !== c1 && (r1 - r0) * (c1 - c0) > 400 && !b.solid) { c = c1 - 1; continue; }
        const k = r * cols + c;
        if (grid[k] >= 0) union(i, grid[k]); else grid[k] = i;
      }
    }
  });
  const groups = new Map();
  boxes.forEach((b, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); });
  return [...groups.values()].map((members) => {
    const x = Math.min(...members.map((m) => m.x)), y = Math.min(...members.map((m) => m.y));
    return { x, y, w: Math.max(...members.map((m) => m.x + m.w)) - x, h: Math.max(...members.map((m) => m.y + m.h)) - y, members };
  });
}
const inside = (it, r, m = 1.5) => { const cx = it.x + it.w / 2, cy = it.y + it.h / 2; return cx >= r.x - m && cx <= r.x + r.w + m && cy >= r.y - m && cy <= r.y + r.h + m; };
const overlaps = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { ...a, x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

// ------------------------------------------------------------------------------------------------- lines
/** Items on one baseline, split where a gap is wider than a column gutter; small raised items join the line beside
 *  them as superscripts. Each line: { items, x0, x1, top, bottom, base, size } */
function buildLines(items, body) {
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.base - it.base) < Math.min(r.size, it.h) * 0.32 && !(it.h < r.size * 0.8 && r.base - it.base > r.size * 0.15));
    if (row) { row.items.push(it); row.size = Math.max(row.size, it.h); }
    else rows.push({ base: it.base, size: it.h, items: [it] });
  }
  // superscripts: a row of a few small items (markers, ¹, *) above the baseline of a row next to it
  for (const r of [...rows]) {
    const txt = r.items.map((i) => i.s).join('').trim();
    if (r.size >= body * 0.85 || txt.length > 4 || !/^[\d*†‡§¹²³⁴-⁹a-z,]+$/i.test(txt)) continue;
    const host = rows.find((o) => o !== r && o.size > r.size * 1.15 && r.base < o.base && r.base > o.base - o.size * 0.95
      && o.items.some((oi) => r.items.some((ri) => ri.x >= oi.x - 2 * o.size && ri.x <= oi.x + oi.w + 1.5 * o.size)));
    if (!host) continue;
    for (const it of r.items) host.items.push({ ...it, sup: true });
    rows.splice(rows.indexOf(r), 1);
  }
  const lines = [];
  for (const r of rows) {
    r.items.sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of r.items) {
      const gap = cur ? it.x - cur.x1 : 0;
      if (!cur || gap > 1.6 * Math.max(it.h, cur.size)) {
        cur = { items: [], x0: it.x, x1: it.x + it.w, top: it.y, bottom: it.y + it.h, base: r.base, size: it.sup ? r.size : it.h };
        lines.push(cur);
      }
      cur.items.push(it);
      cur.x1 = Math.max(cur.x1, it.x + it.w);
      if (!it.sup) { cur.top = Math.min(cur.top, it.y); cur.bottom = Math.max(cur.bottom, it.y + it.h); cur.size = Math.max(cur.size, it.h); }
    }
  }
  return lines.filter((l) => l.items.some((i) => !i.sup));
}

/** The text of a line as runs [{ text, b, i, sup, mono }] and its plain text. */
function lineRuns(line) {
  const runs = [];
  let text = '';
  let prev = null;
  for (const it of line.items) {
    let t = it.s.replace(/\s+/g, ' ');
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const space = !it.sup && !NO_SPACE_AFTER.test(text) && !NO_SPACE_BEFORE.test(t) && gap > 0.15 * Math.min(it.h, prev.h);
      if (space && !/^\s/.test(t)) t = ' ' + t;
    } else t = t.replace(/^\s+/, '');
    const style = { b: !!it.bold, i: !!it.italic, sup: !!it.sup, mono: !!it.mono };
    const last = runs[runs.length - 1];
    if (last && last.b === style.b && last.i === style.i && last.sup === style.sup && last.mono === style.mono) last.text += t;
    else runs.push({ text: t, ...style });
    text += t;
    prev = it;
  }
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  return { runs: runs.filter((r) => r.text), text: text.trim() };
}

/** Common left (right) edges of the lines of a page: x values that start (end) several lines, with their counts. */
function edges(lines, key, size) {
  const xs = lines.map((l) => l[key]).sort((a, b) => a - b);
  const out = [];
  for (const x of xs) {
    const g = out.find((e) => Math.abs(e.x - x) < size * 0.6);
    if (g) { g.n++; g.sum += x; g.x = g.sum / g.n; } else out.push({ x, n: 1, sum: x });
  }
  return out.filter((e) => e.n >= 2);
}
/** The edge of the column a line belongs to: of the common edges on its side and near it, the one most lines share
 *  (an indented first line is a common x as well, but fewer lines start there than at the column edge). */
function columnEdge(list, x, size, left, strict = false) {
  const near = list.filter((e) => (left ? e.x <= x + 1 && x - e.x < 6 * size : e.x >= x - 1 && e.x - x < 6 * size));
  if (!near.length) return strict ? null : x;
  return near.sort((a, b) => b.n - a.n || (left ? a.x - b.x : b.x - a.x))[0].x;
}

// ------------------------------------------------------------------------------------------------- the page
/**
 * The page model of raw page data.
 * @param {object} raw  see pdf-text-extract.js extractPage
 * @param {{ body?: number, titles?: Set<string>, chess?: boolean }} [ctx]  body: the document's body size;
 *   titles: headKey() of the book title and the outline entries (running heads repeat them)
 * @returns {{ index, w, h, kind: 'text'|'image'|'blank', blocks: object[], notes: object[], figures: object[],
 *   dropped: string[], body: number, chars: number }}
 */
export function assemblePage(raw, ctx = {}) {
  const W = raw.w, H = raw.h;
  const fonts = raw.fonts || [];
  const items = raw.items.map((it) => {
    const f = fonts[it.f] || {};
    return { s: it.s.replace(/\u00a0/g, ' '), x: it.x, y: it.y, w: it.w, h: it.h, base: it.b ?? it.y + it.h * 0.8, rot: it.r || 0, bold: !!f.bold, italic: !!f.italic || !!it.sk, mono: !!f.mono };
  }).filter((it) => it.s.trim() && it.x < W && it.x + it.w > 0 && it.y < H && it.y + it.h > 0);
  const flat = items.filter((it) => !it.rot);
  const localBody = bodySizeOf(flat);
  const chars = flat.reduce((n, it) => n + it.s.replace(/\s+/g, '').length, 0);
  const body = ctx.body && (chars < 600 || Math.abs(localBody - ctx.body) < 1.2) ? ctx.body : localBody;
  const model = { index: raw.index, w: W, h: H, kind: 'text', blocks: [], notes: [], figures: [], dropped: [], body, chars };

  // ---- the page as a whole: a scan, junk text, nothing
  const pics = (raw.images || []).filter((r) => r.k !== 'shading' && r.w >= 16 && r.h >= 16);
  const picArea = pics.reduce((a, r) => a + r.w * r.h, 0);
  const allText = flat.map((it) => it.s).join(' ');
  const verdict = inspectText(allText);
  const scanLike = picArea > 0.55 * W * H && pics.some((r) => r.w * r.h > 0.3 * W * H);
  if (chars < 12 && (pics.length || (raw.paths || []).length > 3)) { model.kind = 'image'; model.reason = 'empty'; return model; }
  if (chars < 12) { model.kind = 'blank'; return model; }
  if (verdict.junk && verdict.reason !== 'symbols') { model.kind = 'image'; model.reason = verdict.reason; return model; }
  if (scanLike && (chars < 120 || verdict.junk)) { model.kind = 'image'; model.reason = 'scan'; return model; }

  // ---- figures
  const boxes = [];
  if (!scanLike) for (const r of pics) boxes.push({ ...r, kind: 'photo', solid: true });
  const paths = (raw.paths || []).filter((p) => p.w * p.h < 0.6 * W * H && (p.w >= 1.2 || p.h >= 1.2));
  const isRule = (p) => (p.h <= 2.2 && p.w >= 6) || (p.w <= 2.2 && p.h >= 6);
  const rules = paths.filter(isRule);
  for (const p of paths) if (!isRule(p) && p.w * p.h >= 4) boxes.push({ ...p, kind: 'path' });
  for (const p of rules) boxes.push({ ...p, kind: 'rule' });
  // rows in a diagram font or other symbol rows are pictures as well
  const junkRows = [];
  for (const it of flat) {
    if (it.s.trim().length < 3) continue;
    const v = inspectText(it.s);
    if (v.junk && (v.reason === 'symbols' || v.reason === 'words' || v.reason === 'chars')) junkRows.push(it);
  }
  for (const it of junkRows) boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, kind: 'glyphs', solid: true });
  const textItems = flat.filter((it) => !junkRows.includes(it));
  let figures = [];
  for (const c of clusters(boxes, W, H, 4)) {
    const kinds = new Set(c.members.map((m) => m.kind));
    const nRules = c.members.filter((m) => m.kind === 'rule').length, nPaths = c.members.filter((m) => m.kind === 'path').length;
    const inText = textItems.filter((it) => inside(it, c, 0));
    const textLen = inText.reduce((n, it) => n + it.s.trim().length, 0);
    let fig = false;
    if (kinds.has('photo') || kinds.has('glyphs')) fig = true;
    else if (nPaths >= 3 || (nPaths >= 1 && c.w * c.h > 900 && textLen < 0.02 * c.w * c.h)) fig = true;
    else if (nRules >= 5 && c.w > 60 && c.h > 30) fig = true;   // a table drawn with rules
    // a box behind a paragraph (a coloured frame, an info box) stays text
    if (fig && !kinds.has('photo') && !kinds.has('glyphs') && nPaths <= 2 && textLen > 160) fig = false;
    // a rule under a heading, an underline, a footnote separator: no figure
    if (fig && c.w < 14 && c.h < 14) fig = false;
    if (fig) figures.push({ x: c.x, y: c.y, w: c.w, h: c.h, kind: kinds.has('photo') && !nPaths && !kinds.has('glyphs') ? 'photo' : 'drawing', parts: c.members.length });
  }
  // the labels around a figure (axis numbers, coordinates a–h and 1–8, a legend): short or small text close to it
  for (let pass = 0; pass < 3; pass++) {
    let grew = false;
    for (const f of figures) {
      for (const it of textItems) {
        if (inside(it, f, 1)) continue;
        const short = it.s.trim().length <= 5 || (it.h < body * 0.86 && it.s.trim().length <= 24);
        if (!short || it.h > body * 1.05) continue;
        const near = it.x + it.w > f.x - 14 && it.x < f.x + f.w + 14 && it.y + it.h > f.y - 12 && it.y < f.y + f.h + 12;
        if (!near) continue;
        // a short line of the running text right under a figure (the end of a paragraph) is not a label
        if (it.s.trim().length > 5 && Math.abs(it.h - body) < 0.6) continue;
        Object.assign(f, union(f, it)); grew = true;
      }
    }
    if (!grew) break;
  }
  // overlapping figures are one figure
  figures.sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < figures.length; i++) {
    for (let j = i + 1; j < figures.length; j++) {
      if (overlaps(figures[i], figures[j], 2)) { const k = figures[i].kind === figures[j].kind ? figures[i].kind : 'drawing'; Object.assign(figures[i], union(figures[i], figures[j]), { kind: k }); figures.splice(j, 1); j = i; }
    }
  }
  figures = figures.filter((f) => f.w >= 18 && f.h >= 18).map((f, k) => {
    const pad = f.kind === 'photo' ? 2 : 5;   // drawings: room for the soft edge of the picture (pdf-text-view.js)
    const x = Math.max(0, f.x - pad), y = Math.max(0, f.y - pad);
    return { id: k, kind: f.kind, x, y, w: Math.min(W, f.x + f.w + pad) - x, h: Math.min(H, f.y + f.h + pad) - y };
  });
  model.figures = figures;

  // ---- lines of the running text
  const free = textItems.filter((it) => !figures.some((f) => inside(it, f, 0.5)));
  // a drop cap: one or two big letters beside the first lines of a paragraph join the line on their right
  const caps = free.filter((it) => it.s.trim().length <= 2 && /\p{L}/u.test(it.s) && it.h > body * 1.8);
  let lines = buildLines(free.filter((it) => !caps.includes(it)), body);
  for (const cap of caps) {
    const host = lines.filter((l) => l.x0 > cap.x + cap.w - 1 && l.x0 < cap.x + cap.w + body * 2.5 && l.base > cap.y && l.base < cap.base + body * 0.5)
      .sort((a, b) => a.base - b.base)[0];
    if (host) { host.items.unshift({ ...cap, h: host.size, y: host.top, x: host.x0 - 0.1, dropCap: true }); host.x0 = cap.x; }
    else lines.push(...buildLines([cap], body));
  }
  const pitch = median(lines.filter((l) => Math.abs(l.size - body) < 1).map((l) => l.bottom - l.top)) || body * 1.2;

  // ---- running heads and page numbers
  const titles = ctx.titles || new Set();
  const isMargin = (line, top, rest) => {
    const t = lineRuns(line).text;
    if (!t || t.length > 140) return false;
    if (top ? line.bottom > H * 0.14 : line.top < H * 0.84) return false;
    if (line.size > body * 1.1) return false;
    const k = headKey(t);
    const near = rest.length ? Math.min(...rest.map((l) => (top ? l.top - line.bottom : line.top - l.bottom))) : 0;
    return PAGE_NUMBER.test(t) || titles.has(k) || titles.has(headKey(t.replace(/^\d+\s*[·|–-]?\s*|\s*[·|–-]?\s*\d+$/g, ''))) || line.size < body * 0.93 || near > 2.2 * pitch;
  };
  for (const top of [true, false]) {
    for (let n = 0; n < 3 && lines.length > 1; n++) {
      const edge = top ? Math.min(...lines.map((l) => l.top)) : Math.max(...lines.map((l) => l.bottom));
      const row = lines.filter((l) => (top ? l.top - edge < 0.5 * l.size : edge - l.bottom < 0.5 * l.size));
      const rest = lines.filter((l) => !row.includes(l));
      if (!rest.length || !row.every((l) => isMargin(l, top, rest))) break;
      // a footnote at the very foot is no running element: it has a marker and words
      if (!top && row.some((l) => /^\S{1,3}\s+\p{L}{3,}/u.test(lineRuns(l).text) && lineRuns(l).text.length > 24 && !PAGE_NUMBER.test(lineRuns(l).text))) break;
      for (const l of row) model.dropped.push(lineRuns(l).text);
      lines = rest;
    }
  }

  // ---- footnotes: small lines at the foot of the text, below a short rule or starting with a marker
  const bodyLines = lines.filter((l) => Math.abs(l.size - body) < body * 0.12);
  const textBottom = bodyLines.length ? Math.max(...bodyLines.map((l) => l.bottom)) : 0;
  const footRule = rules.filter((r) => r.h <= 2.2 && r.w >= 20 && r.w < W * 0.5 && r.y > H * 0.45).sort((a, b) => b.y - a.y)
    .find((r) => lines.some((l) => l.top > r.y && l.top - r.y < pitch * 2.5 && l.size < body * 0.95));
  let noteLines = [];
  {
    const below = (l) => (footRule ? l.top > footRule.y : l.top >= textBottom - 0.5);
    const cand = lines.filter((l) => l.size < body * 0.93 && l.size > body * 0.45 && l.top > H * 0.45 && below(l)).sort((a, b) => a.base - b.base);
    if (cand.length) {
      const first = lineRuns(cand[0]).text;
      const marked = cand[0].items[0]?.sup || /^(?:\d{1,3}|[*†‡§]+)\s*\S/.test(first);
      const lowest = Math.max(...lines.filter((l) => !cand.includes(l)).map((l) => l.bottom), 0);
      if ((footRule || marked) && cand.every((l) => l.top >= lowest - 1)) noteLines = cand;
    }
  }
  lines = lines.filter((l) => !noteLines.includes(l));
  model.notes = notesOf(noteLines);

  // ---- reading order with the figures in their place
  const figLines = figures.map((f) => ({ fig: f, x0: f.x, x1: f.x + f.w, top: f.y, bottom: f.y + f.h, base: f.y + f.h, size: body, items: [] }));
  const order = readingOrder([...lines, ...figLines], body);
  const lefts = edges(lines, 'x0', body), rights = edges(lines, 'x1', body);
  const leftOf = (l) => columnEdge(lefts, l.x0, body, true);
  const rightOf = (l) => columnEdge(rights, l.x1, body, false);
  // the text frame of the page (for centred lines): the most common left edge and the right edge of the long lines (in
  // text set ragged right, the line ends differ), else the middle of the page
  const mainL = [...lefts].sort((a, b) => b.n - a.n)[0]?.x;
  const ends = lines.filter((l) => Math.abs(l.size - body) < body * 0.15).map((l) => l.x1).sort((a, b) => a - b);
  const mainR = ends.length >= 3 ? ends[Math.floor(ends.length * 0.9)] : undefined;
  const frame = mainL != null && mainR != null && mainR - mainL > W * 0.3 ? { l: mainL, r: mainR } : { l: W * 0.12, r: W * 0.88 };
  const flow = [];   // lines and figures in reading order, lines of one baseline merged
  for (const block of order) {
    let prev = null;
    // the right edge of the block: a line without a common edge near it (a caption, a ragged line) is measured by it
    const blockRight = Math.max(...block.map((l) => l.x1));
    for (const l of block) {
      if (l.fig) { flow.push({ fig: l.fig, blockStart: !prev }); prev = null; continue; }
      if (prev && Math.abs(prev.base - l.base) < l.size * 0.3 && l.x0 > prev.x1) {
        prev.items.push(...l.items); prev.x1 = l.x1; continue;
      }
      const line = { ...l, items: [...l.items], blockStart: !prev, blockRight };
      flow.push(line);
      prev = line;
    }
  }
  // a line that starts at no common edge (a caption, a line set in) never reaches "the" right edge of a column
  const anchored = (l) => columnEdge(lefts, l.x0, body, true, true) != null;
  model.blocks = paragraphs(flow, { body, pitch, leftOf, rightOf: (l) => Math.max(rightOf(l), l.blockRight ?? 0), frame, anchored });
  attachCaptions(model);
  return model;
}

/** Footnote lines → notes [{ marker, runs, text }] */
function notesOf(lines) {
  const notes = [];
  for (const l of lines) {
    const { runs, text } = lineRuns(l);
    let marker = null;
    if (l.items[0]?.sup) marker = runs[0]?.sup ? runs[0].text.trim() : null;
    const m = !marker && /^(\d{1,3}|[*†‡§]+)[.)]?\s+(?=\S)/.exec(text);
    if (m) marker = m[1];
    if (marker || !notes.length) {
      let rest = runs;
      if (marker) {
        rest = runs.map((r) => ({ ...r }));
        if (rest[0]?.sup) rest.shift();
        else if (m) rest[0].text = rest[0].text.slice(m[0].length);
        if (rest[0]) rest[0].text = rest[0].text.replace(/^\s+/, '');
      }
      notes.push({ marker, runs: rest.filter((r) => r.text) });
    } else {
      const last = notes[notes.length - 1];
      joinRuns(last.runs, runs);
    }
  }
  for (const n of notes) n.text = n.runs.map((r) => r.text).join('');
  return notes.filter((n) => n.text.trim());
}

/** Appends the runs of a line to the runs of a paragraph: a word hyphenated at the line end is joined. */
function joinRuns(target, runs) {
  const plain = target.map((r) => r.text).join('');
  const next = runs.map((r) => r.text).join('').trimStart();
  const last = target[target.length - 1];
  const m = /(\p{L}{2,})[-\u00ad¬]$/u.exec(plain);
  if (m && /^\p{Ll}/u.test(next) && !HYPHEN_KEEP.test(next)) last.text = last.text.slice(0, -1);
  else if (/\u00ad$/.test(plain)) last.text = last.text.slice(0, -1);
  else if (m && /^[\p{Lu}\d]/u.test(next) && plain.endsWith('-')) { /* "Schach-" + "Bundesliga" */ }
  else if (last?.sup) target.push({ text: ' ', b: false, i: false, sup: false, mono: false });
  else if (last && !/\s$/.test(last.text)) last.text += ' ';
  for (const r of runs) {
    const t = target[target.length - 1];
    const text = r === runs[0] ? r.text.replace(/^\s+/, '') : r.text;
    if (t && t.b === r.b && t.i === r.i && t.sup === r.sup && t.mono === r.mono) t.text += text;
    else target.push({ ...r, text });
  }
}

/**
 * Paragraphs, headings and list items of the lines in reading order.
 * A block: { t: 'p'|'h'|'li'|'fig', runs, level?, ordered?, marker?, indent, lower, open, full, size, x0, top, bottom }
 */
function paragraphs(flow, { body, pitch, leftOf, rightOf, frame, anchored }) {
  // a line in the middle of the text frame, clearly narrower than it and away from its left edge, is centred
  const centred = (line) => {
    const mid = (frame.l + frame.r) / 2, w = line.x1 - line.x0;
    return Math.abs((line.x0 + line.x1) / 2 - mid) < Math.max(body * 0.9, (frame.r - frame.l) * 0.03) && w < (frame.r - frame.l) * 0.86 && line.x0 - frame.l > 1.5 * body;
  };
  const out = [];
  let para = null, prev = null;
  const close = () => { if (para) { finish(para); out.push(para); } para = null; };
  const finish = (p) => {
    const text = p.runs.map((r) => r.text).join('').trim();
    p.text = text;
    p.open = !END_CLOSED.test(text) || /[-\u00ad,;]$/.test(text);
    p.endsSentence = END_SENTENCE.test(text);
  };
  for (const item of flow) {
    if (item.fig) { close(); out.push({ t: 'fig', fig: item.fig }); prev = null; continue; }
    const line = item;
    const { runs, text } = lineRuns(line);
    if (!text) continue;
    const left = leftOf(line), right = rightOf(line);
    const indent = line.x0 - left > 0.8 * body && line.x0 - left < 8 * body;
    const big = line.size > body * 1.15;
    const allBold = runs.every((r) => r.b || r.sup) && runs.some((r) => r.b);
    const bullet = BULLET.exec(text), num = !bullet && ENUM.exec(text);
    const listStart = (bullet || (num && /^\S+\s+\p{L}/u.test(text))) && !big;
    const gap = prev ? line.top - prev.bottom : 0;
    const sizeChange = prev && Math.abs(line.size - prev.size) > 0.12 * Math.max(line.size, prev.size);
    const prevShort = prev && prev.x1 < rightOf(prev) - Math.max(2 * body, 0.15 * (rightOf(prev) - leftOf(prev)));
    // under the text of a list item (its start is estimated when marker and text are one item: then an indented
    // paragraph after an item that ended a sentence is no part of it)
    const offText = para && para.t === 'li' ? Math.abs(line.x0 - para.textX) : Infinity;
    const underItem = offText < body * 0.3 || (para?.textGuess && offText < body * 0.6 && !END_CLOSED.test(prevText(para)));
    // at the top of the next column (or below a gap) a paragraph goes on when it ended open: a lower-case start, a
    // hyphen or comma at its end, or a full last line without the end of a sentence
    const goesOn = () => {
      if (!para || para.t !== 'p' || indent || listStart || big) return false;
      const done = prevText(para);
      if (END_CLOSED.test(done) && !/[-­,;]$/.test(done) && !(para.full && !END_SENTENCE.test(done))) return false;
      return /^\p{Ll}/u.test(text) || /[-­,;]$/.test(done) || (para.full && !END_SENTENCE.test(done));
    };
    let newPara = !para || (item.blockStart && !goesOn())
      || (!item.blockStart && gap > 0.55 * pitch)
      || sizeChange
      || (indent && !underItem)
      || listStart
      || (para.t === 'h' && !big && !(allBold && para.bold))
      || (big && para.t !== 'h')
      || (prevShort && END_CLOSED.test(prevText(para)) && !underItem)
      // a centred line (a caption, a title) and the text beside it are not one paragraph
      || (para.t === 'p' && para.centered !== centred(line))
      // nor a short line set in from the edge (a caption under a picture) and a line that starts at the edge
      || (para.t === 'p' && prevShort && prev.x0 - leftOf(prev) > 2 * body && Math.abs(line.x0 - leftOf(line)) < 0.5 * body);
    // a list item goes on with the lines that start under its text
    if (para && para.t === 'li' && !listStart && !big && gap <= 0.55 * pitch && underItem) newPara = false;
    if (newPara) {
      close();
      let t = 'p', level = 0, marker = null, ordered = false, textX = line.x0, textGuess = false;
      let r = runs;
      if (big) { t = 'h'; level = line.size >= body * 1.9 ? 1 : line.size >= body * 1.4 ? 2 : 3; }
      else if (listStart) {
        t = 'li'; marker = (bullet || num)[1]; ordered = !bullet;
        r = runs.map((x) => ({ ...x }));
        let cut = (bullet || num)[0].length;
        while (cut > 0 && r.length) { const n = Math.min(cut, r[0].text.length); r[0].text = r[0].text.slice(n); cut -= n; if (!r[0].text) r.shift(); }
        // the text of the item starts where its first word does (for the lines that follow)
        const firstWord = line.items.find((i) => !BULLET.test(i.s + ' ') && !ENUM.test(i.s + ' ') && i.x > line.x0 + 0.5);
        if (firstWord) textX = firstWord.x;
        else {
          // marker and text in one item: its start from the width of the marker (letters of about equal width)
          const it0 = line.items[0];
          textX = it0.x + (bullet || num)[0].length * (it0.w / Math.max(1, it0.s.length));
          textGuess = true;
        }
      }
      para = { t, level, marker, ordered, textX, textGuess, runs: r.map((x) => ({ ...x })), indent, lower: /^\p{Ll}/u.test(text), size: line.size, x0: line.x0, x1: line.x1, left, right, top: line.top, bottom: line.bottom, bold: allBold, lines: 1, full: false, centered: false };
      para.centered = centred(line);
    } else {
      joinRuns(para.runs, runs);
      para.lines++;
      para.bottom = line.bottom;
      para.bold = para.bold && allBold;
      para.x1 = Math.max(para.x1, line.x1);
    }
    para.full = anchored(line) && line.x1 >= right - 1.5 * body;
    para.lastText = text;
    prev = line;
  }
  close();
  // a short bold paragraph of its own is a heading (level 4): "Was im Frühling zu tun ist"
  out.forEach((p, i) => {
    if (p.t === 'p' && p.bold && p.lines <= 2 && p.text.length <= 120 && !END_SENTENCE.test(p.text)) {
      const next = out[i + 1];
      if (!next || next.t !== 'p' || !next.bold) { p.t = 'h'; p.level = 4; }
    }
  });
  return out;
}
const prevText = (p) => p?.lastText || '';

/** A paragraph right under (or above) a figure that names it ("Abb. 3:", "Figure 2") or is set in italics is its
 *  caption. */
function attachCaptions(model) {
  const blocks = model.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.t !== 'fig') continue;
    const f = b.fig;
    const near = (p, below) => p && p.t === 'p' && p.lines <= 4 && (below ? p.top - (f.y + f.h) < model.body * 2.6 && p.top >= f.y + f.h - 4 : f.y - p.bottom < model.body * 2.2 && p.bottom <= f.y + 4);
    // a short line under the picture and within its width ("Weiß am Zug")
    const under = (p) => p.lines <= 2 && p.text.length < 160 && p.x0 > f.x + model.body && p.x1 < f.x + f.w + model.body;
    const isCap = (p) => CAPTION.test(p.text) || (p.runs.every((r) => r.i || !r.text.trim()) && p.text.length < 300) || p.size < model.body * 0.95
      || (p.centered && p.lines <= 2 && p.text.length < 160) || under(p);
    const after = blocks[i + 1], before = blocks[i - 1];
    if (near(after, true) && isCap(after)) { b.caption = after.runs; blocks.splice(i + 1, 1); }
    else if (near(before, false) && CAPTION.test(before.text)) { b.caption = before.runs; blocks.splice(i - 1, 1); i--; }
  }
}

// ------------------------------------------------------------------------------------------------- sections
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function runsHtml(runs, hyphenate = null) {
  return runs.map((r) => {
    if (r.sup) return `<sup>${esc(r.text.trim())}</sup>`;
    // the spaces around a styled word stay outside its tags
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
    let t = esc(hyphenate && !r.mono ? hyphenate(m[2]) : m[2]);
    if (!t) return m[0];
    if (r.mono) t = `<code>${t}</code>`;
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return m[1] + t + m[3];
  }).join('');
}
export const markerId = (page) => `tv-p${page}`;
const marker = (page) => `<span class="tv-pg" id="${markerId(page)}" data-page="${page}"></span>`;

/** Does the first block of a page continue the last paragraph of the page before? */
export function continues(prevPara, next) {
  if (!prevPara || !next || prevPara.t !== 'p' || next.t !== 'p' || next.indent || next.centered) return false;
  if (!prevPara.open && !(prevPara.full && !prevPara.endsSentence)) return false;
  const prevText = prevPara.runs.map((r) => r.text).join('').trimEnd();
  return next.lower || /[-\u00ad,;]$/.test(prevText) || (prevPara.full && !END_SENTENCE.test(prevText));
}

/**
 * The HTML body of a section: pages [first … last] (page models), the page after it (`nextPage`, to finish a paragraph
 * that runs on) and whether its own first paragraph was already taken by the section before (`skipLead`).
 * figureHtml(page, fig, captionHtml) gives the markup of a picture (the view knows its image), pageHtml(page) the one of
 * a page that is a picture as a whole; hyphenate(text) puts soft hyphens into the running text (CSS has no hyphenation
 * dictionaries in Electron on Windows).
 * @returns {{ html: string, tookLead: boolean }} tookLead: the first paragraph of nextPage is here
 */
export function buildSection(pages, { nextPage = null, skipLead = false, figureHtml, pageHtml, hyphenate = null }) {
  const html = (runs) => runsHtml(runs, hyphenate);
  const out = [];
  let open = null;            // the last paragraph, while it may go on: { cls, parts, runsTail }
  let lastPara = null;        // the block that ended it (open, full …)
  let list = null;            // the list the page ended with: { tag, items } (it may go on on the next page)
  let notesAfter = [];        // footnotes of a page whose last paragraph or list is still open
  let tookLead = false;
  const notesHtml = (notes) => `<aside class="tv-notes">${notes.map((n) => `<p class="tv-note">${n.marker ? `<sup>${esc(n.marker)}</sup> ` : ''}${html(n.runs)}</p>`).join('')}</aside>`;
  const closeOpen = () => {
    if (open) { out.push(`<p${open.cls}>${open.parts.join('')}</p>`); open = null; }
    if (list) { out.push(`<${list.tag} class="tv-list">${list.items.join('')}</${list.tag}>`); list = null; }
    if (notesAfter.length) { out.push(notesHtml(notesAfter)); notesAfter = []; }
  };
  const liHtml = (b, pre = '') => `<li${b.ordered && /^\d+/.test(b.marker || '') ? ` value="${parseInt(b.marker, 10)}"` : ''}>${pre}${html(b.runs)}</li>`;
  const emitPage = (page) => {
    const blocks = page.kind === 'text' ? page.blocks : [];
    if (page.kind !== 'text') {
      closeOpen();
      out.push(marker(page.index));
      if (page.kind === 'image') out.push(pageHtml(page));
      lastPara = null;
      return;
    }
    let i = 0, pageMark = marker(page.index);
    if (skipLead && page === pages[0]) {
      out.push(pageMark);   // its first paragraph stands at the end of the section before
      pageMark = '';
      i = blocks.length ? 1 : 0;
    } else if (open && continues(lastPara, blocks[0])) {
      open.parts.push(pageMark);
      pageMark = '';
      appendRuns(open, blocks[0].runs, hyphenate);
      lastPara = blocks[0];
      i = 1;
    } else if (!(list && blocks[0]?.t === 'li' && (blocks[0].ordered ? 'ol' : 'ul') === list.tag)) {
      closeOpen();
      out.push(pageMark);
      pageMark = '';
    }
    for (; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.t === 'li' && list && (b.ordered ? 'ol' : 'ul') === list.tag) {
        // the list goes on (also across the page break: the page marker opens the item)
        if (open) closeOpen();
        list.items.push(liHtml(b, pageMark));
        pageMark = '';
        lastPara = null;
        continue;
      }
      closeOpen();
      lastPara = null;
      if (b.t === 'fig') { out.push(figureHtml(page, b.fig, b.caption ? runsHtml(b.caption) : '')); continue; }
      if (b.t === 'h') { const tag = `h${Math.min(6, Math.max(1, b.level))}`; out.push(`<${tag} class="tv-h${b.centered ? ' tv-center' : ''}">${runsHtml(b.runs)}</${tag}>`); continue; }
      if (b.t === 'li') { list = { tag: b.ordered ? 'ol' : 'ul', items: [liHtml(b)] }; continue; }
      open = { cls: b.centered ? ' class="tv-center"' : b.indent ? '' : ' class="tv-noindent"', parts: [html(b.runs)], runsTail: b.runs };
      lastPara = b;
    }
    if (pageMark) out.push(pageMark);
    // the footnotes of the page follow the paragraph (or list) in which the page ends
    if (page.notes?.length) {
      if (open || list) notesAfter.push(...page.notes);
      else out.push(notesHtml(page.notes));
    }
  };
  for (const p of pages) emitPage(p);
  if (open && nextPage?.kind === 'text' && continues(lastPara, nextPage.blocks[0])) {
    open.parts.push(marker(nextPage.index));
    appendRuns(open, nextPage.blocks[0].runs, hyphenate);
    tookLead = true;
  }
  closeOpen();
  return { html: out.join('\n'), tookLead };
}
function appendRuns(open, runs, hyphenate = null) {
  // the hyphen at the end of the page goes when the word goes on in lower case
  const last = open.parts.length - 2;   // the part before the marker
  const prevHtml = open.parts[last] ?? '';
  const next = runs.map((r) => r.text).join('').trimStart();
  const m = /(\p{L}{2,})[-\u00ad¬]((?:<\/[bi]>)*)$/u.exec(prevHtml);
  if (m && /^\p{Ll}/u.test(next) && !HYPHEN_KEEP.test(next)) open.parts[last] = prevHtml.slice(0, m.index + m[1].length) + m[2];
  else if (!(m && /^[\p{Lu}\d]/u.test(next))) open.parts[open.parts.length - 1] = ' ' + open.parts[open.parts.length - 1];
  open.parts.push(runsHtml(runs.map((r, k) => (k === 0 ? { ...r, text: r.text.replace(/^\s+/, '') } : r)), hyphenate));
  open.runsTail = runs;
}

/** Plain text of a section's HTML (tests, read-aloud checks): markers and tags removed. */
export function htmlText(html) {
  return String(html).replace(/<sup>[^<]*<\/sup>/g, '').replace(/<\/?(?:b|i|code|span)(?:\s[^>]*)?>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
