#!/usr/bin/env node
// Tests of the reader's text view of PDFs and of its typography (Cozy Shelves 0.7). Run: node app/src/ui/reader/__tests__/run.js
//   the page assembly (pdf-text-assemble.js) on the raw page data of invented test books (fixtures/pdf-text-pages.json,
//   made by build/testlib/dump_reader_fixtures.mjs): paragraphs joined across lines, columns and pages, hyphenated
//   words, headings, lists, footnotes, running heads and page numbers, figures with captions, chess diagrams, a scanned
//   page and a page whose font gives junk; the sections of a book; the font styles from font names; the page width
//   (characters per line → the layout of the paginator) and the settings of older builds (margins → page width).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const importApp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n', e?.stack || e); }
}
const norm = (s) => String(s || '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

(async () => {
  const A = await importApp('app/src/ui/reader/pdf-text-assemble.js');
  const X = await importApp('app/src/ui/reader/pdf-text-extract.js');
  const V = await importApp('app/src/ui/reader/pdf-text-view.js');
  const S = await importApp('app/src/ui/reader/reader-styles.js');
  const { DEFAULTS: MAIN_DEFAULTS, migrateSettings } = require(path.join(ROOT, 'electron', 'settings.js'));
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf-text-pages.json'), 'utf8')).books;

  /** a whole book as the text view builds it: one section of all pages, figures as placeholders */
  function book(b, opts = {}) {
    const body = A.documentBodySize(b.pages.slice(1, 6));
    const titles = new Set([b.truth?.title, ...(b.truth?.outline || []).map((o) => o.title)].filter(Boolean).map(A.headKey));
    const pages = b.pages.map((r) => A.assemblePage(r, { body, titles, ...opts }));
    const figureHtml = (page, f, cap) => `<figure class="tv-fig tv-${f.kind}" data-page="${page.index}">[FIG]${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
    const pageHtml = (page) => `<figure class="tv-fig tv-page" data-page="${page.index}">[PAGE]</figure>`;
    const { html } = A.buildSection(pages, { figureHtml, pageHtml });
    return { pages, html, text: norm(A.htmlText(html)) };
  }
  const de = book(fx.de), en = book(fx.en);

  console.log('a German book set like a word processor (pdf-text-assemble.js)');
  await test('every paragraph comes out whole and in order (joined across lines, pages and columns)', () => {
    let at = -1;
    for (const p of fx.de.truth.paragraphs) {
      const i = de.text.indexOf(norm(p.text));
      assert(i >= 0, `missing: ${p.text.slice(0, 80)}`);
      assert(i > at, `out of order: ${p.text.slice(0, 60)}`);
      at = i;
    }
  });
  await test('each paragraph is one <p> (no paragraph is cut, none runs into the next)', () => {
    const paras = [...de.html.matchAll(/<p(?: class="[^"]*")?>([\s\S]*?)<\/p>/g)].map((m) => norm(A.htmlText(m[1]))).filter((t) => t.length > 40);
    for (const p of fx.de.truth.paragraphs) assert(paras.includes(norm(p.text)), `not a paragraph of its own: ${p.text.slice(0, 70)}`);
  });
  await test('a word hyphenated across a page break is joined, with the page marker inside it', () => {
    assert(/Morgen<span class="tv-pg" id="tv-p4" data-page="4"><\/span>grauen/.test(de.html), 'Morgen⟦4⟧grauen');
    assert(!/Morgen-/.test(de.html));
    for (const w of ['Sommermonate', 'Treibholz', 'Obstbäume', 'Dachrinne', 'Hinweistafeln', 'Wasserräder']) assert(de.text.includes(w), w);
  });
  await test('headings by size and weight, the title page centred', () => {
    assert(/<h1 class="tv-h tv-center">(?:<b>)?Der Fluss im Jahreslauf/.test(de.html));
    for (const t of ['1 Frühling am Fluss', '2 Sommer', '3 Herbst', '4 Winter']) assert(new RegExp(`<h2 class="tv-h">(?:<b>)?${t}`).test(de.html), t);
    assert(/<h3 class="tv-h">(?:<b>)?Was im Frühling zu tun ist/.test(de.html));
  });
  await test('italic and bold words keep their style', () => {
    assert(/<i>stille Zeit,<\/i>/.test(de.html), 'stille Zeit');
    assert(/<b>Frühling<\/b>/.test(de.html), 'Frühling');
  });
  await test('running heads and page numbers are left out', () => {
    const p = de.pages.find((x) => x.index === 3);
    assert.deepStrictEqual(p.dropped, ['Der Fluss im Jahreslauf', '4']);
    assert(!/Frühling am Fluss\s*3/.test(de.text));
    assert.strictEqual((de.text.match(/Der Fluss im Jahreslauf/g) || []).length, 1, 'the book title only as the title');
  });
  await test('footnotes: the marker stays raised in the text, the note follows the paragraph in which its page ends', () => {
    for (const n of fx.de.truth.notes) {
      const re = new RegExp(`<aside class="tv-notes">[^]*?<sup>${n.n}</sup> ${n.text.slice(0, 30)}`);
      assert(re.test(de.html), `note ${n.n}`);
    }
    assert(/hinaus\.<sup>1<\/sup><\/p>\n<h3/.test(de.html.replace(/\n<aside[^]*?<\/aside>/, '')), 'marker 1 in the text');
    // note 3 belongs to page 4, whose last paragraph runs on to page 5: the note comes after that paragraph
    assert(/Öfen anheizen\.<\/p>\n<aside class="tv-notes"><p class="tv-note"><sup>3<\/sup>/.test(de.html), 'note 3 after the paragraph that ends on page 5');
  });
  await test('lists: bullets and numbers, a line of an item that wraps stays in it', () => {
    assert(/<ul class="tv-list"><li>Die Beete von altem Laub[^<]*<\/li><li>Die Obstbäume[^<]*<\/li><li>Die Regentonne[^<]*anschließen\.<\/li><\/ul>/.test(de.html));
    assert(/<ol class="tv-list"><li value="1">Feuer[^<]*<\/li><li value="2">[^<]*<\/li><li value="3">Nach zehn Uhr am Abend leise sein, denn die Häuser liegen nah am Wasser\.<\/li><\/ol>/.test(de.html));
  });
  await test('figures: the photo and the chart with their captions, at the place of the truth', () => {
    const figs = de.pages.flatMap((p) => p.figures.map((f) => ({ ...f, page: p.index })));
    for (const t of fx.de.truth.figures.filter((f) => f.kind !== 'scan')) {
      const [x, y, w, h] = t.rect;
      const f = figs.find((g) => g.page === t.page - 1);
      assert(f, `figure of page ${t.page}`);
      const ix = Math.max(0, Math.min(f.x + f.w, x + w) - Math.max(f.x, x)), iy = Math.max(0, Math.min(f.y + f.h, y + h) - Math.max(f.y, y));
      assert(ix * iy > 0.75 * w * h && f.w * f.h < 1.6 * w * h, `figure of page ${t.page}: ${JSON.stringify([f.x, f.y, f.w, f.h])} truth ${t.rect}`);
      assert.strictEqual(f.kind, t.kind === 'photo' ? 'photo' : 'drawing');
    }
    assert(/\[FIG\]<figcaption><i>Abb\. 1: Der Fluss am Morgen, kurz nach der Schneeschmelze\.<\/i><\/figcaption>/.test(de.html));
    assert(/\[FIG\]<figcaption><i>Abb\. 2: Mittlere Wassertemperatur im Sommer, gemessen an der alten Brücke\.<\/i><\/figcaption>/.test(de.html));
    // the labels of the chart are part of the picture, not of the text
    assert(!/Juni Juli August September/.test(de.text) && !/\b17,5\b/.test(de.text));
  });
  await test('a scanned page and a page whose font map gives junk become pictures of the whole page', () => {
    for (const t of fx.de.truth.pages.filter((p) => p.kind === 'scan' || p.kind === 'junk')) {
      const p = de.pages.find((x) => x.index === t.page - 1);
      assert.strictEqual(p.kind, 'image', `page ${t.page}`);
      assert(new RegExp(`<figure class="tv-fig tv-page" data-page="${t.page - 1}">`).test(de.html));
    }
    assert(!/Iz Olyiza|Ph Ollza/.test(de.text), 'no shifted letters in the text');
  });
  await test('every page has its marker, in order', () => {
    const marks = [...de.html.matchAll(/data-page="(\d+)"><\/span>/g)].map((m) => +m[1]);
    assert.deepStrictEqual([...new Set(marks)], fx.de.pages.map((p) => p.index));
  });

  console.log('an English book set in TJ arrays with kerning (LaTeX style), two columns');
  await test('every paragraph whole and in order, the paragraph across the column break joined', () => {
    let at = -1;
    for (const p of fx.en.truth.paragraphs) {
      const i = en.text.indexOf(norm(p.text));
      assert(i > at, `missing or out of order: ${p.text.slice(0, 70)}`);
      at = i;
    }
    assert(en.text.includes("the building was once the miller's house"));
  });
  await test('a list that goes on on the next page stays one list', () => {
    assert(/<ul class="tv-list"><li>A pair of binoculars[^]*?<\/li><li>A small notebook[^]*?<\/li><li><span class="tv-pg" id="tv-p2" data-page="2"><\/span>Warm socks[^]*?<\/li><\/ul>/.test(en.html));
  });
  await test('the footnote marker and note, the photo with its caption', () => {
    assert(/two days\.<sup>1<\/sup>/.test(en.html));
    assert(/<aside class="tv-notes"><p class="tv-note"><sup>1<\/sup> The ferry was replaced/.test(en.html));
    assert(/\[FIG\]<figcaption><i>Figure 1: The river in the early morning, seen from the ferry landing\.<\/i><\/figcaption>/.test(en.html));
  });

  console.log('chess diagrams (build/testlib/gen_chess.py): pictures in the text, the caption under them');
  await test('raster and vector diagrams are figures that hold the whole board and its coordinates', () => {
    const c = book(fx.chess);
    for (const d of fx.chess.truth.diagrams) {
      const p = c.pages.find((x) => x.index === d.page);
      assert.strictEqual(p.figures.length, 1, `page ${d.page + 1}: ${p.figures.length} figures`);
      const f = p.figures[0], [bx, by, bs] = d.board;
      assert(f.x <= bx + 1 && f.y <= by + 1 && f.x + f.w >= bx + bs - 1 && f.y + f.h >= by + bs - 1, `page ${d.page + 1}: board inside ${JSON.stringify(f)}`);
      assert(f.w < bs * 1.35 && f.h < bs * 1.35, `page ${d.page + 1}: not much more than the board`);
      assert.strictEqual(f.kind, d.kind === 'image' || d.kind === 'scan' ? 'photo' : 'drawing', `page ${d.page + 1}`);
    }
    assert(/\[FIG\]<figcaption>Weiß am Zug<\/figcaption>/.test(c.html) && /\[FIG\]<figcaption>Schwarz am Zug<\/figcaption>/.test(c.html));
    assert(!/[♔♕♖♗♘♙♚♛♜♝♞♟]/.test(c.text), 'no piece glyphs in the text');
  });

  console.log('sections, page places and the paragraph across a section boundary');
  await test('sections: chapters of the outline, long ones split, about ten pages without an outline', () => {
    assert.deepStrictEqual(V.sectionRanges(10, [1, 3, 5, 6]), [[0, 0], [1, 2], [3, 4], [5, 5], [6, 9]]);
    assert.deepStrictEqual(V.sectionRanges(25, []), [[0, 8], [9, 17], [18, 24]]);
    assert.deepStrictEqual(V.sectionRanges(12, []), [[0, 11]]);
    const r = V.sectionRanges(1000, [2, 400]);
    assert(r.every(([a, b]) => b - a + 1 <= 14) && r[0][0] === 0 && r[r.length - 1][1] === 999);
    for (let i = 1; i < r.length; i++) assert.strictEqual(r[i][0], r[i - 1][1] + 1);
  });
  await test('a section ending in a paragraph that runs on finishes it with the next page; the next section skips it', () => {
    const pages = de.pages;
    const fig = () => '', pg = () => '';
    const a = A.buildSection(pages.slice(3, 4), { nextPage: pages[4], figureHtml: fig, pageHtml: pg });
    assert.strictEqual(a.tookLead, true);
    assert(/Morgen<span class="tv-pg" id="tv-p4" data-page="4"><\/span>grauen zurück, wenn die ersten Vögel singen und die Bäcker im Dorf ihre Öfen anheizen\.<\/p>/.test(a.html));
    const b = A.buildSection(pages.slice(4, 5), { skipLead: true, figureHtml: fig, pageHtml: pg });
    assert(b.html.startsWith('<span class="tv-pg" id="tv-p4" data-page="4"></span>'));
    assert(!/grauen zurück/.test(b.html) && /Wer im Sommer am Fluss zeltet/.test(b.html));
  });
  await test('page CFIs of the PDF view and of the text view', () => {
    assert.strictEqual(V.pdfPageCfi(0), 'epubcfi(/6/2)');
    assert.strictEqual(V.pageOfPdfCfi('epubcfi(/6/24)'), 11);
    assert.strictEqual(V.pageOfPdfCfi('epubcfi(/6/24!/4/2/1:3)'), 11);
    assert.strictEqual(V.pageOfPdfCfi('epubcfi(/8/4!/4/2/1:0)'), null);
  });

  console.log('font styles from font names (pdf-text-extract.js)');
  await test('bold, italic and monospace', () => {
    const cases = { 'ABCDEF+MinionPro-Bold': [1, 0], 'Times-Italic': [0, 1], 'Times-BoldItalic': [1, 1], 'Arial,Bold': [1, 0], 'Garamond-Semibold': [1, 0], 'LMRoman10-Regular': [0, 0], 'SourceSerifPro-It': [0, 1], 'Helvetica-Oblique': [0, 1], 'NimbusSanL-BoldItal': [1, 1], 'Georgia': [0, 0], 'CMR10': [0, 0], 'Courier': [0, 0] };
    for (const [n, [b, i]] of Object.entries(cases)) { const s = X.fontStyle(n); assert.deepStrictEqual([+s.bold, +s.italic], [b, i], n); }
    assert(X.fontStyle('CourierNewPSMT').mono && X.fontStyle('LMMono10-Regular').mono);
  });

  console.log('page width and settings (reader-styles.js, electron/settings.js)');
  await test('the column of the paginator is as wide as the page width asks for', () => {
    for (const [pageWidth, fontSize, columns, vw] of [[68, 19, 2, 1496], [45, 19, 2, 1496], [110, 19, 2, 2472], [90, 24, 2, 1496], [60, 10, 1, 800]]) {
      const s = { pageWidth, fontSize, columns, font: 'garamond', flow: 'paginated' };
      const L = S.pageLayout(s, vw, 800);
      const G = 0.06, a = G / (1 - G);
      // foliate (paginator.js #beforeRender): container C = min(maxInline · n, vw · (1 − G)), column = C / n − a · C
      const C = Math.min(L.maxInline * L.columns, vw * (1 - G));
      const col = C / L.columns - a * C;
      const want = Math.min(L.text, vw * (1 - G) * (1 - a));
      assert(Math.abs(col - want) < 2, `${pageWidth} chars at ${fontSize}px in ${vw}px: column ${col.toFixed(1)} want ${want.toFixed(1)} (${L.columns} columns)`);
      if (L.columns === 2) assert(2 * L.text / (1 - 2 * a) <= vw * (1 - G) + 1);
    }
    assert.strictEqual(S.pageLayout({ pageWidth: 110, fontSize: 19, columns: 2, font: 'garamond' }, 1496, 800).columns, 1, 'two wide columns do not fit');
    assert.strictEqual(S.pageLayout({ pageWidth: 68, fontSize: 19, columns: 2, font: 'garamond' }, 900, 1200).columns, 1, 'portrait: one column');
  });
  await test('the margin presets of 0.6 become page widths, once, in the main process and in the reader', () => {
    for (const [margin, width] of Object.entries(S.MARGIN_WIDTHS)) {
      const s = structuredClone(MAIN_DEFAULTS);
      s.reader.margin = margin; delete s.reader.widthSchema;
      migrateSettings(s);
      assert.strictEqual(s.reader.pageWidth, width, margin);
      assert.strictEqual('margin' in s.reader, false);
      assert.strictEqual(s.reader.widthSchema, 1);
      s.reader.pageWidth = 77;   // chosen afterwards
      migrateSettings(s);
      assert.strictEqual(s.reader.pageWidth, 77);
      const r = { margin, fontSize: 21 };
      assert.strictEqual(S.migrateReader(r), true);
      assert.deepStrictEqual(r, { fontSize: 21, pageWidth: width, widthSchema: 1 });
      assert.strictEqual(S.migrateReader(r), false);
    }
    const fresh = structuredClone(MAIN_DEFAULTS);
    migrateSettings(fresh);
    assert.strictEqual(fresh.reader.pageWidth, S.DEFAULTS.pageWidth);
    assert.strictEqual(MAIN_DEFAULTS.reader.pageWidth, S.DEFAULTS.pageWidth, 'the same default in both');
    assert.strictEqual(MAIN_DEFAULTS.reader.fontSize, S.DEFAULTS.fontSize);
  });
  await test('every reading font is bundled or a font of the system, with its license', () => {
    for (const [k, f] of Object.entries(S.FONTS)) {
      if (!f.dir) { assert(k === 'garamond' || f.system, k); continue; }
      for (const subset of ['latin', 'latin-ext']) for (const st of ['400-normal', '400-italic', '700-normal', '700-italic']) {
        assert(fs.existsSync(path.join(ROOT, 'app', 'data', 'fonts', f.dir, `${f.dir}-${subset}-${st}.woff2`)), `${k} ${subset} ${st}`);
      }
      assert(/SIL Open Font License/.test(fs.readFileSync(path.join(ROOT, 'app', 'data', 'fonts', f.dir, 'OFL.txt'), 'utf8')), `${k} license`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
