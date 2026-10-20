// Check: the text view of PDFs and the typography of the reader (0.7).
//   switch    a PDF in the page view, X: the text view at the same page; the Aa menu has the switch; back at the same
//             page; the switch is remembered per book (the book opens in the text view again, another PDF does not)
//   typo      font, font size and page width in the text view: the rendered line length follows the page width, the
//             size the slider and Ctrl+Plus/Minus/0 (the window itself is never zoomed), every font loads offline
//   pages     turning pages: the PDF page in the bottom bar, the progress, the saved place (a page CFI of the PDF),
//             the pictures loaded, the footnotes and the paragraph across a page break
//   marks     a bookmark set in the text view belongs to its PDF page (ribbon in both views, the sidebar leads back)
//   scan      a scanned page and a page with a broken font are pictures of the page inside the text
//   epub      an EPUB uses the page width slider (the line length follows), the margin presets of 0.6 migrate
//   perf      the longest frame while switching between the views, after the first build of the chapter (≤ 50 ms, or
//             as long as a page turn of the page view in the same minute; a round slowed only by the graphics card
//             that the test runs share is measured again)
//   chess     (with the chess library) the diagrams of a chess book are pictures in the text, the snip reads them
//   tts       read-aloud in the text view starts with the text on screen (dry run, needs a German Piper voice)
//   shots     the German book in the page view and in the text view, two fonts and widths, paper and night
//
//   python build/testlib/gen_reader_books.py <books>
//   python build/testlib/gen_chess.py lib <chess>                    (optional, for the part "chess")
//   COZYSHELVES_BOOKS="<books>/lib|structured;<chess>|structured" COZYSHELVES_USERDATA=<fresh folder> SHOT_DIR=<folder>
//   [COZYSHELVES_PIPER_DIR=<folder with de_DE-thorsten-medium>] node build/screenshot.js reader-text-check
// TV_PARTS=switch,typo,… runs only those parts; TV_SIZE=2560x1440 sets the window size (default 1600 × 900).
const fs = require('fs');
const path = require('path');
const kit = require('./audit-lib');

const PARTS = (process.env.TV_PARTS || 'switch,typo,pages,marks,scan,epub,perf,chess,tts,shots').split(',').map((s) => s.trim());
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log, shot, app } = k;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); };
  const libs = (process.env.COZYSHELVES_BOOKS || '').split(';').map((x) => x.split('|')[0]).filter(Boolean);
  const truthFile = libs.map((l) => path.join(l, '..', 'reader-truth.json')).find((f) => fs.existsSync(f));
  const truth = truthFile ? JSON.parse(fs.readFileSync(truthFile, 'utf8')) : {};
  const chessDir = libs.find((l) => fs.existsSync(path.join(l, 'chess-truth.json')));
  const chessTruth = chessDir ? JSON.parse(fs.readFileSync(path.join(chessDir, 'chess-truth.json'), 'utf8')) : null;

  if (process.env.TV_SIZE) {
    const [w, h] = process.env.TV_SIZE.split('x').map(Number);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win?.setContentSize(w, h); }, [w, h]);
    await sleep(600);
  }
  await k.boot();
  const books = await page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, t: b.title, f: b.format, rel: (b.relPath || '').replace(/\\/g, '/'), chess: b.isChess })));
  const find = (rel) => books.find((b) => b.rel.endsWith(rel));
  const de = find('Sachbuch/Der Fluss im Jahreslauf.pdf'), en = find('Englisch/The River Year.pdf'), epub = find('Romane/Am Ufer.epub');
  const chessPdf = chessTruth ? find(chessTruth.pdf) : null;
  const deTruth = truth['Sachbuch/Der Fluss im Jahreslauf.pdf'];
  log('BOOKS ' + JSON.stringify({ de: de?.t, en: en?.t, epub: epub?.t, chess: chessPdf?.t, truth: !!deTruth }));
  if (!de || !deTruth) { check('library', false, 'the test books of gen_reader_books.py are missing'); log(`SUMMARY reader-text-check: ${pass} passed, ${fail} failed`); return; }

  // ---- helpers ------------------------------------------------------------------------------------------------------
  const setReader = (patch) => page.evaluate((p) => window.api.settings.set({ reader: p }), patch);
  /** settings.reader.textView with the text view on for these books and off for the other test PDFs (the main process
   *  merges the settings key by key: an empty object would leave every book as it was) */
  const tvOnly = (...on) => Object.fromEntries([de, en, chessPdf].filter(Boolean).map((b) => [b.id, on.includes(b)]));
  async function openBook(b, wait = 1500) {
    await k.closeAll();
    await k.open('reader', { id: b.id }, wait);
    await page.waitForFunction(() => !document.querySelector('.rd-loading') && document.querySelector('.rd-view')?.renderer, null, { timeout: 60000 }).catch(() => {});
    await sleep(900);
  }
  const st = () => page.evaluate(() => {
    const tv = window.__readerText;
    return {
      fixed: document.querySelector('.rd-root')?.classList.contains('rd-fixed') ?? null,
      text: !!tv?.active, busy: !!tv?.busy,
      label: document.querySelector('.rd-page')?.textContent || '',
      percent: document.querySelector('.rd-percent')?.textContent || '',
      // the progress in the running foot of a double page (foliate's feet), '' with one column
      foot: (() => { const f = document.querySelector('.rd-view')?.renderer?.feet; return f?.length > 1 ? f[f.length - 1].textContent : ''; })(),
      slider: +document.querySelector('.rd-slider')?.value || 0,
    };
  });
  const pageNo = (label) => +(/(\d+)\s+(?:von|of)/.exec(label)?.[1] || 0);
  /** waits until the view is settled after a switch (no build running, the section laid out) */
  async function settle(wantText, ms = 30000) {
    const t0 = Date.now();
    for (;;) {
      const s = await st();
      if (!s.busy && s.text === wantText && s.fixed === !wantText && s.label) return s;
      if (Date.now() - t0 > ms) return s;
      await sleep(150);
    }
  }
  /** runs fn(doc, arg) with the section document of the text view (or of an EPUB); the source goes in as an expression
   *  (the app's CSP allows no eval inside the page) */
  const docEval = (fn, arg) => page.evaluate(`(() => { const doc = document.querySelector('.rd-view')?.renderer?.getContents?.()[0]?.doc; return doc ? (${fn.toString()})(doc, ${JSON.stringify(arg ?? null)}) : null; })()`);
  /** characters per line of the long paragraphs of the section: text length over lines (the last line counts half) */
  /** characters per line as laid out: the words of every paragraph grouped into lines by their position, the median
   *  of the full lines (not the first, which may be indented, nor the last) */
  const measure = () => docEval((doc) => {
    const lens = [];
    for (const p of doc.querySelectorAll('p')) {
      const lines = [];
      const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const re = /\S+/g;
        let m;
        while ((m = re.exec(n.nodeValue))) {
          const r = doc.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          const rc = [...r.getClientRects()].filter((x) => x.width > 0)[0];
          if (!rc) continue;
          const last = lines[lines.length - 1];
          const len = m[0].replace(/­/g, '').length;   // soft hyphens are no characters of the line
          if (last && Math.abs(last.top - rc.top) < 3 && rc.left > last.right - 2) { last.chars += 1 + len; last.right = rc.left; }
          else lines.push({ top: rc.top, right: rc.left, chars: len });
        }
      }
      for (const l of lines.slice(1, -1)) lens.push(l.chars);
    }
    lens.sort((a, b) => a - b);
    const cs = getComputedStyle(doc.documentElement);
    const first = doc.querySelector('p') || doc.body;
    return { cpl: lens.length ? lens[Math.floor(lens.length / 2)] : 0, lines: lens.length, colW: parseFloat(cs.columnWidth) || 0, font: getComputedStyle(first).fontFamily, size: parseFloat(getComputedStyle(first).fontSize) };
  });
  async function aa(open = true) {
    const isOpen = await page.evaluate(() => !document.querySelector('.rd-settings')?.classList.contains('hidden'));
    if (isOpen !== open) { await page.keyboard.press('s'); await sleep(450); }
  }
  /** moves a range slider of the Aa menu like a user (input events while dragging, then change) */
  const slide = (sel, value) => page.evaluate(([s, v]) => {
    const el = document.querySelector(s); if (!el) return false;
    el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, [sel, value]);
  const errorsNow = () => k.errors.filter((e) => !/Failed to load resource|sandboxing|pointer lock/i.test(e));

  // ================================================================================================================
  if (PARTS.includes('switch')) {
    await setReader({ theme: 'paper', themeChosen: true, pageWidth: 68, fontSize: 19, font: 'garamond', columns: 2, flow: 'paginated', textView: tvOnly(), textViewHints: 0 });
    await openBook(de);
    const hint = await page.waitForFunction(() => document.querySelector('.rd-tvhint')?.innerText || null, null, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
    check('hint-first-pdf', !!hint && /Fließtext|flowing text/.test(hint), hint);
    await shot('tv-hint');
    // to page 4 in the page view, then X
    await page.evaluate(() => document.querySelector('.rd-view').goTo(3));
    await sleep(1200);
    const before = await st();
    const t0 = Date.now();
    await page.keyboard.press('x');
    const s1 = await settle(true);
    const ms = Date.now() - t0;
    check('switch-to-text', s1.text && !s1.fixed && pageNo(s1.label) === pageNo(before.label), `${before.label} → ${s1.label} in ${ms} ms (first build of the chapter)`);
    const head = await docEval((doc) => [...doc.querySelectorAll('h2')].map((x) => x.textContent).join(' | '));
    check('text-shows-the-page', /2\s+Sommer/.test(head || ''), head);
    await aa(true);
    const menu = await page.evaluate(() => ({ sw: !!document.querySelector('.rd-settings .rd-tv-group [role="switch"][aria-checked="true"]'), fonts: [...document.querySelectorAll('.rd-settings .rd-font')].map((b) => b.textContent), width: !!document.querySelector('.rd-settings .rd-width-range'), size: !!document.querySelector('.rd-settings .rd-size-range') }));
    check('aa-menu-text-view', menu.sw && menu.fonts.length >= 6 && menu.width && menu.size, menu);
    // the switch in the menu: back to the page view, same page
    const s1b = await st();
    await page.evaluate(() => document.querySelector('.rd-settings .rd-tv-group [role="switch"]').click());
    const s2 = await settle(false);
    check('switch-back-same-page', s2.fixed && !s2.text && pageNo(s2.label) === pageNo(s1b.label), `${s1b.label} → ${s2.label}`);
    const menu2 = await page.evaluate(() => ({ sw: !!document.querySelector('.rd-settings .rd-tv-group [role="switch"][aria-checked="false"]'), zoom: [...document.querySelectorAll('.rd-settings .rd-seg')].some((b) => /Seite|Page/.test(b.textContent)) }));
    check('aa-menu-page-view', menu2.sw && menu2.zoom, menu2);
    await aa(false);
    // remembered per book: on again, close, open again → text view; another PDF opens in the page view
    await page.keyboard.press('x');
    await settle(true);
    await sleep(600);
    await openBook(en);
    const sEn = await st();
    await openBook(de);
    const sDe = await settle(true, 20000);
    const stored = await page.evaluate(async () => (await window.api.settings.get()).reader.textView);
    check('remembered-per-book', sDe.text && !sEn.text && stored[de.id] === true && Object.values(stored).filter(Boolean).length === 1, { de: sDe.label, enText: sEn.text, stored });
    // off again: the book opens in the page view next time
    await page.keyboard.press('x');
    await settle(false);
    await sleep(900);
    await openBook(de);
    const sOff = await settle(false, 20000);
    const storedOff = await page.evaluate(async () => (await window.api.settings.get()).reader.textView);
    check('switched-off-remembered', !sOff.text && sOff.fixed && storedOff[de.id] === false, { de: sOff.label, stored: storedOff });
  }

  // ================================================================================================================
  if (PARTS.includes('typo')) {
    await setReader({ textView: tvOnly(de), pageWidth: 68, fontSize: 19, font: 'garamond', columns: 2, flow: 'paginated' });
    await openBook(de);
    await settle(true);
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:3'));
    await sleep(1200);
    const base = await measure();
    await aa(true);
    const widths = {};
    for (const w of [50, 68, 90]) {
      await slide('.rd-settings .rd-width-range', w);
      await sleep(900);
      widths[w] = await measure();
    }
    const label = await page.evaluate(() => document.querySelector('.rd-settings .rd-width-val')?.textContent);
    const ok = (w) => Math.abs(widths[w].cpl - w) / w < 0.1;
    check('page-width-line-length', ok(50) && ok(68) && ok(90) && widths[50].cpl < widths[68].cpl && widths[68].cpl < widths[90].cpl,
      `chars per line: 50 → ${widths[50].cpl.toFixed(1)}, 68 → ${widths[68].cpl.toFixed(1)}, 90 → ${widths[90].cpl.toFixed(1)}; columns ${widths[50].colW.toFixed(0)}/${widths[68].colW.toFixed(0)}/${widths[90].colW.toFixed(0)} px; label "${label}"; at open ${base.cpl.toFixed(1)}`);
    await slide('.rd-settings .rd-width-range', 68); await sleep(600);
    // font size: slider, buttons, Ctrl+Plus/Minus/0
    await slide('.rd-settings .rd-size-range', 26); await sleep(700);
    const s26 = await measure();
    await page.evaluate(() => [...document.querySelectorAll('.rd-settings .rd-step')].find((b) => b.textContent === '−').click()); await sleep(600);
    const s25 = await measure();
    await aa(false);
    await page.keyboard.press('Control+0'); await sleep(600);
    const s19 = await measure();
    await page.keyboard.press('Control+Equal'); await sleep(600);
    const s20 = await measure();
    await page.keyboard.press('Control+Minus'); await sleep(600);
    const s19b = await measure();
    const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()))?.webContents.getZoomFactor());
    check('font-size', s26.size === 26 && s25.size === 25 && s19.size === 19 && s20.size === 20 && s19b.size === 19 && zoom === 1, `slider 26 → ${s26.size}, − → ${s25.size}, Ctrl+0 → ${s19.size}, Ctrl+Plus → ${s20.size}, Ctrl+Minus → ${s19b.size}; window zoom ${zoom}`);
    // every font: the face in the section document is the chosen one and loaded from the app (offline)
    const fontRes = {};
    await aa(true);
    for (const key of ['garamond', 'literata', 'sourceserif', 'serif', 'atkinson', 'sans']) {
      await page.evaluate((kk) => document.querySelector(`.rd-settings .rd-font[data-font="${kk}"]`)?.click(), key);
      await sleep(1100);
      fontRes[key] = await docEval((doc, kk) => {
        const p = doc.querySelector('p');
        const fam = getComputedStyle(p).fontFamily;
        const first = fam.split(',')[0].replace(/["']/g, '').trim();
        const faces = [...doc.fonts].filter((f) => f.family.replace(/["']/g, '') === first);
        return { first, faces: faces.length, loaded: faces.filter((f) => f.status === 'loaded').length, check: doc.fonts.check(`19px "${first}"`), key: kk };
      }, key);
    }
    const bundled = ['garamond', 'literata', 'sourceserif', 'atkinson'];
    const fontsOk = bundled.every((kk) => fontRes[kk]?.loaded > 0) && ['serif', 'sans'].every((kk) => fontRes[kk]?.first);
    check('fonts-load-offline', fontsOk, fontRes);
    await page.evaluate(() => document.querySelector('.rd-settings .rd-font[data-font="garamond"]')?.click()); await sleep(500);
    await aa(false);
  }

  // ================================================================================================================
  if (PARTS.includes('pages')) {
    await setReader({ textView: tvOnly(de), pageWidth: 68, fontSize: 19, font: 'garamond', columns: 2 });
    await openBook(de);
    await settle(true);
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:0'));
    await sleep(900);
    const seen = [], feet = [];
    let last = await st();
    seen.push(pageNo(last.label));
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(650);
      last = await st();
      seen.push(pageNo(last.label));
      if (last.foot) feet.push(last.foot === last.percent ? '' : `${last.foot} ≠ ${last.percent}`);
    }
    // to the end of the book: its last screen may show several PDF pages, the progress is then 100 %; the running foot
    // shows the progress of the bar
    const mono = seen.every((v, i) => i === 0 || v >= seen[i - 1]);
    const endState = await st();
    const footOff = feet.filter(Boolean);
    check('turn-pages', mono && seen[seen.length - 1] >= 7 && endState.percent === '100 %' && feet.length > 0 && !footOff.length,
      `${seen.join(' ')}, at the end ${endState.percent}; running foot ${feet.length - footOff.length}/${feet.length} as the bar ${footOff.join(', ')}`);
    // one screen back: the saved place is the PDF page there, the progress its share of the book
    await page.keyboard.press('ArrowLeft'); await sleep(900);
    const saved = await page.evaluate(async (id) => { await new Promise((r) => setTimeout(r, 3500)); const b = await window.api.library.book(id); return { loc: b.lastLocation, progress: b.progress, text: (b.currentPageText || '').slice(0, 60) }; }, de.id);
    const cur = await st();
    const wantCfi = `epubcfi(/6/${pageNo(cur.label) * 2})`;
    check('saved-place-is-a-pdf-page', saved.loc === wantCfi && Math.abs(saved.progress - pageNo(cur.label) / deTruth.pageCount) < 0.001 && saved.text.length > 10, { saved, label: cur.label, want: wantCfi });
    // the pictures of the sections seen so far are loaded, the footnotes and the paragraph across the page break are there
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:3'));
    await sleep(1000);
    const sec = await docEval((doc) => ({
      imgs: [...doc.querySelectorAll('figure.tv-fig img')].map((i) => ({ w: i.naturalWidth, k: i.closest('figure').className })),
      notes: [...doc.querySelectorAll('aside.tv-notes')].map((a) => a.textContent.trim().slice(0, 40)),
      joined: /Morgengrauen zurück/.test(doc.body.textContent.replace(/­/g, '').replace(/\s+/g, ' ')),
      caption: [...doc.querySelectorAll('figcaption')].map((c) => c.textContent),
    }));
    check('figures-loaded', sec.imgs.length >= 1 && sec.imgs.every((i) => i.w > 100), sec.imgs);
    check('footnotes-and-joined-paragraph', sec.notes.length >= 1 && sec.joined && sec.caption.some((c) => /Abb\. 2/.test(c)), sec);
    // the text of all paragraphs of the truth is in the sections of the book
    const all = await page.evaluate(async () => {
      const tv = window.__readerText.view;
      const out = [];
      for (let k = 0; k < tv.ranges.length; k++) { const d = await tv.book.sections[k].createDocument(); out.push(d.body.textContent); }
      return out.join(' ');
    });
    const flat = norm(all.replace(/[­]/g, ''));
    const missing = deTruth.paragraphs.filter((p) => !flat.includes(norm(p.text)));
    check('all-paragraphs', !missing.length, missing.map((p) => p.text.slice(0, 50)));
  }

  // ================================================================================================================
  if (PARTS.includes('marks')) {
    await setReader({ textView: tvOnly(de) });
    await openBook(de);
    await settle(true);
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:5'));
    await sleep(1200);
    const at = await st();
    await page.keyboard.press('b');
    await sleep(900);
    const bm = await page.evaluate(async (id) => { await new Promise((r) => setTimeout(r, 600)); return (await window.api.library.book(id)).bookmarks.slice(-1)[0]; }, de.id);
    const ribbonText = await page.evaluate(() => document.querySelector('.rd-ribbon')?.classList.contains('show'));
    check('bookmark-text-view', bm && bm.page === pageNo(at.label) && bm.location === `epubcfi(/6/${pageNo(at.label) * 2})` && ribbonText, { bm, label: at.label, ribbon: ribbonText });
    await page.keyboard.press('x');
    await settle(false);
    await sleep(800);
    const ribbonPage = await page.evaluate(() => document.querySelector('.rd-ribbon')?.classList.contains('show'));
    await page.evaluate(() => document.querySelector('.rd-view').goTo(0)); await sleep(900);
    await page.keyboard.press('x');
    await settle(true);
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:9')); await sleep(900);
    // the sidebar: the bookmark leads back to its page in the text view
    await page.keyboard.press('t'); await sleep(400);
    await page.evaluate(() => document.querySelector('.rd-sb-tab[data-tab="bookmarks"]')?.click()); await sleep(400);
    await page.evaluate(() => document.querySelector('.rd-sb-body .rd-sb-item')?.click()); await sleep(1500);
    const back = await st();
    check('bookmark-both-views', ribbonPage && pageNo(back.label) === bm?.page, { ribbonPageView: ribbonPage, back: back.label, want: bm?.page });
    await page.keyboard.press('Escape'); await sleep(300);
    // remove it again (no traces for the other parts)
    await page.evaluate(async (id) => window.api.library.update(id, { bookmarks: [] }), de.id);
  }

  // ================================================================================================================
  if (PARTS.includes('scan')) {
    await setReader({ textView: tvOnly(de) });
    await openBook(de);
    await settle(true);
    const scanPages = deTruth.pages.filter((p) => p.kind === 'scan' || p.kind === 'junk').map((p) => p.page - 1);
    const res = [];
    for (const p of scanPages) {
      await page.evaluate((i) => document.querySelector('.rd-view').goTo(`tvp:${i}`), p);
      await sleep(1500);
      res.push(await docEval((doc, i) => {
        const f = doc.querySelector(`figure.tv-page[data-page="${i}"] img`);
        const r = f?.getBoundingClientRect();
        return { page: i, w: f?.naturalWidth || 0, h: f?.naturalHeight || 0, shownW: Math.round(r?.width || 0) };
      }, p));
    }
    await page.mouse.move(5, 300); await sleep(3000);
    await shot('tv-scan-page');
    check('scan-as-picture', res.length >= 2 && res.every((r) => r.w > 500 && r.h > 150 && r.shownW > 200), res);
  }

  // ================================================================================================================
  if (PARTS.includes('epub') && epub) {
    // the margin presets of 0.6 (in a reader setting that was never migrated) → page width
    await setReader({ margin: 'wide', widthSchema: 0, pageWidth: 68, fontSize: 19, font: 'garamond', columns: 2, flow: 'paginated' });
    await openBook(epub);
    await aa(true);
    const migrated = await page.evaluate(() => +document.querySelector('.rd-settings .rd-width-range')?.value);
    await aa(false);
    await sleep(800);
    const storedW = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 700)); const r = (await window.api.settings.get()).reader; return { w: r.pageWidth, margin: r.margin ?? null, schema: r.widthSchema }; });
    check('margins-migrate', migrated === 54 && storedW.w === 54 && storedW.schema === 1, { slider: migrated, stored: storedW, note: 'a margin key that stays is no longer read' });
    await aa(true);
    const res = {};
    for (const w of [50, 80]) { await slide('.rd-settings .rd-width-range', w); await sleep(900); res[w] = await measure(); }
    await aa(false);
    check('epub-page-width', Math.abs(res[50].cpl - 50) / 50 < 0.1 && Math.abs(res[80].cpl - 80) / 80 < 0.1, `50 → ${res[50].cpl} (${res[50].lines} lines), 80 → ${res[80].cpl} (${res[80].lines} lines) chars per line`);
    await setReader({ pageWidth: 68 });
  }

  // ================================================================================================================
  if (PARTS.includes('perf')) {
    await setReader({ textView: tvOnly(), pageWidth: 68, fontSize: 19, font: 'garamond', columns: 2 });
    await openBook(de);
    await page.evaluate(() => document.querySelector('.rd-view').goTo(3)); await sleep(1200);
    // the first build of the chapter (not measured), back to the pages
    await page.keyboard.press('x'); await settle(true);
    await page.keyboard.press('x'); await settle(false);
    // the app works in the background now and then (the world paints its pictures after the start): the switches are
    // measured once the main thread was quiet for three seconds
    const quiet = await page.evaluate(async () => {
      const long = [];
      const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(performance.now()); });
      obs.observe({ type: 'longtask' });
      const t0 = performance.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 250));
        const lastLong = long.length ? long[long.length - 1] : t0;
        if (performance.now() - lastLong > 3000) break;
        if (performance.now() - t0 > 40000) break;
      }
      obs.disconnect();
      return Math.round(performance.now() - t0);
    });
    log(`INFO quiet main thread after ${quiet} ms`);
    // per action: the longest frame (requestAnimationFrame) and the long tasks of the main thread (> 50 ms). The frames
    // also wait for the graphics card that the tests share; the long tasks are the work of the reader itself.
    const measureAction = async (press, done) => {
      await page.evaluate(() => {
        window.__frames = []; window.__long = [];
        window.__longObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); });
        window.__longObs.observe({ type: 'longtask' });
        let last = performance.now();
        const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 600 && window.__frameRun) requestAnimationFrame(tick); };
        window.__frameRun = true;
        requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
      });
      await press();
      await done();
      await sleep(900);
      return page.evaluate(() => { window.__frameRun = false; window.__longObs.disconnect(); const f = window.__frames.slice(); return { max: Math.round(Math.max(0, ...f)), long: window.__long.slice() }; });
    };
    // one round: the same book turned in the page view (a baseline under the same load), then six switches (the last
    // one back to the pages, where the next round starts)
    const round = async () => {
      const turns = [];
      for (let i = 0; i < 4; i++) turns.push(await measureAction(() => page.keyboard.press('ArrowRight'), () => sleep(300)));
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
      await sleep(1500);
      const switches = [];
      for (let i = 0; i < 6; i++) {
        const want = i % 2 === 0;
        const r = await measureAction(() => page.keyboard.press('x'), () => settle(want));
        switches.push({ to: want ? 'text' : 'pages', ...r });
      }
      // under the load of other test runs on the same graphics card the main thread waits for it now and then; a
      // switch may then be as slow as a page turn of the page view in the same minute, never slower
      const worstLong = Math.max(0, ...switches.flatMap((f) => f.long)), turnLong = Math.max(0, ...turns.flatMap((f) => f.long));
      const worstFrame = Math.max(...switches.map((f) => f.max)), turnFrame = Math.max(...turns.map((f) => f.max));
      return { switches, pageTurnsInThePageView: turns, longOk: worstLong <= Math.max(50, turnLong + 25), framesOk: worstFrame <= Math.max(50, turnFrame + 25) };
    };
    // slow frames without a long task of the main thread waited for the graphics card that the test runs share (the
    // work of the reader was done): such a round is measured again, at most twice; a long task is never measured away
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      const r = await round();
      rounds.push(r);
      if (!r.longOk || r.framesOk) break;
      await sleep(3000);
    }
    const last = rounds[rounds.length - 1];
    check('switch-frames', last.longOk && last.framesOk,
      { rounds: rounds.map(({ switches, pageTurnsInThePageView }) => ({ switches, pageTurnsInThePageView })), note: 'long: main thread tasks over 50 ms; max: longest frame (with the shared graphics card)' });
  }

  // ================================================================================================================
  if (PARTS.includes('chess') && chessPdf) {
    await setReader({ textView: tvOnly(chessPdf), theme: 'white', themeChosen: true, columns: 2 });
    await openBook(chessPdf, 2500);
    await settle(true);
    const diag = chessTruth.diagrams;
    const pics = [];
    for (const d of diag) {
      await page.evaluate((i) => document.querySelector('.rd-view').goTo(`tvp:${i}`), d.page);
      await sleep(700);
      pics.push(await docEval((doc, i) => { const imgs = [...doc.querySelectorAll(`figure.tv-fig[data-page="${i}"] img`)]; return { page: i, n: imgs.length, w: imgs[0]?.naturalWidth || 0, cap: doc.querySelector(`figure.tv-fig[data-page="${i}"] figcaption`)?.textContent || '' }; }, d.page));
    }
    check('chess-diagrams-as-pictures', pics.every((p) => p.n === 1 && p.w >= 900) && pics.filter((p) => /am Zug/.test(p.cap)).length >= diag.length - 1, pics);
    // the snip on a diagram of the text view (the chess pane opens for a chess book)
    const d0 = diag[0];
    await page.evaluate((i) => document.querySelector('.rd-view').goTo(`tvp:${i}`), d0.page);
    await sleep(1200);
    if (!(await page.evaluate(() => !!document.querySelector('.rd-chess:not(.hidden)')))) { await page.keyboard.press('c'); await sleep(1500); }
    await page.waitForFunction(() => document.querySelector('.rd-chess:not(.hidden) .chess-board'), null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    // the pane made the reading area narrower and the text was laid out again: the diagram is brought on screen the
    // way a reader would turn to it (its column), then taken where it is
    const findBox = () => page.evaluate((i) => {
      const stage = document.querySelector('.rd-stage').getBoundingClientRect();
      for (const c of document.querySelector('.rd-view').renderer.getContents()) {
        const img = c.doc?.querySelector(`figure.tv-fig[data-page="${i}"] img`);
        if (!img) continue;
        const frame = c.doc.defaultView.frameElement, fr = frame.getBoundingClientRect(), b = img.getBoundingClientRect();
        const r = { x: fr.left + b.left, y: fr.top + b.top, w: b.width, h: b.height };
        return { ...r, inside: r.x >= stage.left && r.x + r.w <= stage.right && r.y >= stage.top && r.y + r.h <= stage.bottom };
      }
      return null;
    }, d0.page);
    await page.evaluate((i) => { const c = document.querySelector('.rd-view').renderer; const img = c.getContents()[0]?.doc?.querySelector(`figure.tv-fig[data-page="${i}"] img`); if (img) c.scrollToAnchor(img); }, d0.page);
    await sleep(900);
    let box = await findBox();
    for (let i = 0; i < 4 && box && !box.inside; i++) { await page.keyboard.press('ArrowRight'); await sleep(700); box = await findBox(); }
    await page.mouse.move(5, 400);
    await sleep(400);
    let snipRes = null;
    if (box?.inside) {
      await page.keyboard.press('d');
      await page.waitForSelector('.rd-snip', { timeout: 5000 }).catch(() => {});
      const m = 4;
      await page.mouse.move(box.x - m, box.y - m); await page.mouse.down();
      await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2, { steps: 4 });
      await page.mouse.move(box.x + box.w + m, box.y + box.h + m, { steps: 4 }); await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector('.rd-snip'), null, { timeout: 60000 }).catch(() => {});
      await sleep(600);
      snipRes = await page.evaluate(() => ({ fen: document.querySelector('.rd-chess .chess-fen')?.value || '', source: window.__lastSnip?.source, w: window.__lastSnip?.width }));
      await shot('tv-chess-snip');
    }
    const expand = (p) => String(p).split(' ')[0].split('/').map((r) => r.replace(/\d/g, (x) => '.'.repeat(+x))).join('');
    const a = expand(d0.fen), b = expand(snipRes?.fen || '');
    let same = 0; for (let i = 0; i < 64; i++) if (a[i] === b[i]) same++;
    check('chess-snip-in-text-view', box && snipRes && same >= 62, { box, snip: snipRes, squares: `${same}/64` });
    await page.keyboard.press('c'); await sleep(400);
    // night pages: the diagrams keep their colours (dimmed), drawings and scans would be inverted
    await setReader({ theme: 'night', themeChosen: true });
    await openBook(chessPdf, 2500);
    await settle(true);
    await page.evaluate((i) => document.querySelector('.rd-view').goTo(`tvp:${i}`), diag[2].page);
    await sleep(1200);
    const cls = await docEval((doc, i) => doc.querySelector(`figure.tv-fig[data-page="${i}"]`)?.className, diag[2].page);
    check('chess-night-keeps-colours', /tv-chess|tv-photo/.test(cls || ''), cls);
    await page.mouse.move(5, 300); await sleep(3000);
    await shot('tv-chess-night');
    await setReader({ theme: 'paper', themeChosen: true });
  }

  // ================================================================================================================
  if (PARTS.includes('tts')) {
    await setReader({ textView: tvOnly(de) });
    await page.evaluate(() => window.api.settings.set({ tts: { germanVoice: 'de_DE-thorsten-medium', speed: 1 } }));
    await openBook(de);
    await settle(true);
    await page.evaluate(() => document.querySelector('.rd-view').goTo('tvp:3'));
    await sleep(1200);
    await page.evaluate(() => { window.__ttsTrace = []; window.__ttsDryRun = 0.05; });
    await page.keyboard.press('v');
    let tr = [];
    for (let i = 0; i < 60; i++) { tr = await page.evaluate(() => (window.__ttsTrace || []).map((t) => t.text)); if (tr.length >= 4) break; await sleep(250); }
    const offer = await page.evaluate(() => document.querySelector('.rd-ttsbar.offer')?.innerText || '');
    await page.keyboard.press('Escape'); await sleep(300);
    if (offer) check('read-aloud-text-view', true, 'no German voice on this computer: the bar offers the download (COZYSHELVES_PIPER_DIR for the full check)');
    else check('read-aloud-text-view', tr.length >= 3 && /2 Sommer|Im Sommer wird der Fluss/.test(tr.slice(0, 2).join(' ')), tr.slice(0, 4));
  }

  // ================================================================================================================
  if (PARTS.includes('shots')) {
    const views = [
      ['tv-de-page-paper', { theme: 'paper', textView: tvOnly() }, false],
      ['tv-de-text-garamond-68-paper', { theme: 'paper', textView: tvOnly(de), font: 'garamond', pageWidth: 68, fontSize: 19 }, true],
      ['tv-de-text-literata-54-paper', { theme: 'paper', textView: tvOnly(de), font: 'literata', pageWidth: 54, fontSize: 20 }, true],
      ['tv-de-page-night', { theme: 'night', textView: tvOnly() }, false],
      ['tv-de-text-sourceserif-80-night', { theme: 'night', textView: tvOnly(de), font: 'sourceserif', pageWidth: 80, fontSize: 19 }, true],
      ['tv-de-text-atkinson-62-sepia', { theme: 'sepia', textView: tvOnly(de), font: 'atkinson', pageWidth: 62, fontSize: 19 }, true],
    ];
    for (const [name, patch, text] of views) {
      await setReader({ themeChosen: true, columns: 2, flow: 'paginated', ...patch });
      await openBook(de);
      await settle(text);
      await page.evaluate((t) => document.querySelector('.rd-view').goTo(t ? 'tvp:3' : 3), text);
      await sleep(1200);
      await page.mouse.move(5, 300); await sleep(3200);
      await shot(name);
    }
    await setReader({ theme: 'paper', themeChosen: false, font: 'garamond', pageWidth: 68, fontSize: 19, textView: tvOnly() });
  }

  await k.closeAll();
  const errs = errorsNow();
  check('no-errors', !errs.length, errs.slice(0, 6));
  log(`SUMMARY reader-text-check: ${pass} passed, ${fail} failed`);
};
