// Check: page colours of the reader (Weiß, Papier, Sepia, Nacht) on PDF, EPUB and comic (CBZ) pages, measured on the
// rendered pixels of a screenshot: the paper, the text and a colour picture. Night PDF pages must be dark with light
// text while the picture keeps its colours; comics are dimmed, never inverted. Then "Wie das Erscheinungsbild": the
// pages follow Hell/Sepia/Dunkel live until a colour is chosen. Last, the time to turn a PDF page, white against night.
// Needs the library of `python build/testlib/gen_chess.py lib <folder> <testbooks4\Romane\01 Klassiker>`:
//   COZYSHELVES_BOOKS="<folder>|structured" node build/screenshot.js page-color-check
const kit = require('./audit-lib');
const png = require('./png-lite');

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log, shot } = k;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  await k.boot();
  const books = await page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, f: b.format, t: b.title })));
  const pdf = books.find((b) => b.f === 'pdf' && /Bildtafeln/.test(b.t));
  const chess = books.find((b) => b.f === 'pdf' && /Diagramme/.test(b.t));
  const epub = books.find((b) => b.f === 'epub' && !/Diagramme/.test(b.t)) || books.find((b) => b.f === 'epub');
  const cbz = books.find((b) => b.f === 'cbz');
  log('BOOKS ' + JSON.stringify({ pdf: pdf?.t, chess: chess?.t, epub: epub?.t, cbz: cbz?.t }));

  const setReader = (patch) => page.evaluate((p) => window.api.settings.set({ reader: p }), patch);
  const setUi = async (t) => { await page.evaluate((x) => window.api.settings.set({ ui: { theme: x } }), t); await sleep(500); };
  const shotImg = async (name) => { const buf = await page.screenshot(); if (name) require('fs').writeFileSync(require('path').join(process.env.SHOT_DIR || 'shots', name + '.png'), buf); return png.decode(buf); };
  /** open a book at its first page and wait until every page of the spread is painted */
  async function openAt0(book) {
    await k.closeAll();
    await k.open('reader', { id: book.id }, 1500);
    await page.waitForFunction(() => !document.querySelector('.rd-loading'), null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('.rd-view')?.goTo(0));
    await page.waitForFunction(() => {
      const docs = (document.querySelector('.rd-view')?.renderer?.getContents?.() || []).map((c) => c.doc).filter(Boolean);
      if (!docs.length) return false;
      return docs.every((d) => (d.getElementById('canvas') ? d.querySelector('#canvas > canvas')?.imageRects : (!d.querySelector('img') || d.querySelector('img').complete)));
    }, null, { timeout: 30000 }).catch(() => {});
    await page.mouse.move(5, 300);   // the chrome hides after a while: keep it out of the measured areas
    await sleep(3400);
  }
  /** CSS rectangle of page `index` of a fixed-layout book (iframe in screen coordinates) and the device pixel ratio */
  const pageRect = (index) => page.evaluate((i) => {
    // a spread can hold a blank frame (about:blank, not displayed) next to the first page
    const docs = (document.querySelector('.rd-view')?.renderer?.getContents?.() || []).map((c) => c.doc)
      .filter((x) => x && x.defaultView?.frameElement?.getBoundingClientRect().width > 0 && (x.querySelector('#canvas > canvas') || x.querySelector('img')));
    const d = docs.find((x) => (x.querySelector('#canvas > canvas')?.pageIndex ?? 0) === i) || docs[0];
    const r = d.defaultView.frameElement.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1, theme: d.documentElement.dataset.rdPage || null };
  }, index);
  const ptRegion = (img, pr, pageW, x, y, w, h) => { const z = pr.w / pageW, s = pr.dpr; return png.region(img, (pr.x + x * z) * s, (pr.y + y * z) * s, w * z * s, h * z * s); };

  const PAPER = { white: [255, 255, 255], paper: [249, 243, 230], sepia: [241, 226, 196], night: [30, 26, 22] };
  const STAGE = { white: [255, 255, 255], paper: [244, 236, 219], sepia: [232, 213, 176], night: [21, 17, 13] };
  const SKY = [93, 152, 233];   // the top left of the picture in Bildtafeln.pdf and of the comic pages (generator)
  for (const theme of ['white', 'paper', 'sepia', 'night']) {
    await setReader({ theme, themeChosen: true });
    // ---- PDF with text and a picture
    if (pdf) {
      await openAt0(pdf);
      const img = await shotImg(`pc-pdf-${theme}`);
      const pr = await pageRect(0);
      const paper = ptRegion(img, pr, 432, 12, 12, 30, 30);
      const text = ptRegion(img, pr, 432, 54, 52, 324, 130);
      const sky = ptRegion(img, pr, 432, 64, 238, 60, 16);
      check(`pdf-paper-${theme}`, near(paper.mean, PAPER[theme], 5), `paper=${paper.mean} want≈${PAPER[theme]} filter=${pr.theme}`);
      if (theme === 'night') check(`pdf-text-${theme}`, text.p50 < 70 && text.p98 > 150, `text p50=${text.p50} p98=${text.p98} (dark page, light letters)`);
      else check(`pdf-text-${theme}`, text.p02 < 90 && text.p50 > 180, `text p02=${text.p02} p50=${text.p50} (light page, dark letters)`);
      const blue = sky.mean[2] - sky.mean[0];
      if (theme === 'night') check('pdf-picture-night', blue > 40 && sky.mean[2] < SKY[2] - 20, `sky=${sky.mean} (keeps its colours, dimmed)`);
      else check(`pdf-picture-${theme}`, blue > 60, `sky=${sky.mean}`);
    }
    // ---- EPUB
    if (epub) {
      await openAt0(epub);
      const img = await shotImg(`pc-epub-${theme}`);
      const st = await page.evaluate(() => { const r = document.querySelector('.rd-stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1, theme: document.querySelector('.rd-root')?.dataset.theme }; });
      const bg = png.region(img, (st.x + 52) * st.dpr, (st.y + st.h * 0.42) * st.dpr, 14 * st.dpr, 30 * st.dpr);
      const body = png.region(img, (st.x + st.w * 0.12) * st.dpr, (st.y + st.h * 0.2) * st.dpr, st.w * 0.3 * st.dpr, st.h * 0.5 * st.dpr);
      check(`epub-paper-${theme}`, st.theme === theme && near(bg.mean, STAGE[theme], theme === 'white' ? 8 : 14), `bg=${bg.mean} want≈${STAGE[theme]} root=${st.theme}`);
      if (theme === 'night') check(`epub-text-${theme}`, body.p98 > 150 && body.p50 < 60, `p50=${body.p50} p98=${body.p98}`);
      else check(`epub-text-${theme}`, body.p02 < 100 && body.p50 > 180, `p02=${body.p02} p50=${body.p50}`);
    }
    // ---- comic: tinted or dimmed, never inverted
    if (cbz) {
      await openAt0(cbz);
      const img = await shotImg(`pc-cbz-${theme}`);
      const pr = await pageRect(0);
      const sky = png.region(img, (pr.x + pr.w * 0.05) * pr.dpr, (pr.y + pr.h * 0.02) * pr.dpr, pr.w * 0.12 * pr.dpr, pr.h * 0.03 * pr.dpr);
      const ok = sky.mean[2] - sky.mean[0] > 40 && (theme === 'white' ? near(sky.mean, SKY, 22) : sky.mean[2] < SKY[2] - 3);
      check(`cbz-${theme}`, ok, `sky=${sky.mean} filter=${pr.theme}`);
    }
  }

  // ---- the pages follow the appearance until a colour is chosen
  if (epub) {
    await setReader({ theme: 'paper', themeChosen: false });
    await setUi('sepia');
    await openAt0(epub);
    const rootTheme = () => page.evaluate(() => document.querySelector('.rd-root')?.dataset.theme);
    const t1 = await rootTheme();
    await setUi('dark'); await sleep(400);
    const t2 = await rootTheme();
    await setUi('light'); await sleep(400);
    const t3 = await rootTheme();
    check('follow-appearance', t1 === 'sepia' && t2 === 'night' && t3 === 'paper', `sepia→${t1} dark→${t2} light→${t3}`);
    // the Aa menu: page colours and the switch
    await page.keyboard.press('s'); await sleep(500);
    const menu = await page.evaluate(() => ({ swatches: [...document.querySelectorAll('.rd-settings .rd-swatch')].map((b) => b.textContent), follow: !!document.querySelector('.rd-settings .rd-follow .toggle.on'), label: document.querySelector('.rd-settings .rd-set-label')?.textContent }));
    check('aa-menu', menu.swatches.join(',') === 'Weiß,Papier,Sepia,Nacht' && menu.follow && /Seitenfarbe/.test(menu.label || ''), JSON.stringify(menu));
    await shot('pc-aa-menu');
    await page.evaluate(() => [...document.querySelectorAll('.rd-settings .rd-swatch')].find((b) => b.dataset.theme === 'white')?.click()); await sleep(400);
    await setUi('dark'); await sleep(400);
    const t4 = await rootTheme();
    const stored = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 700)); const s = (await window.api.settings.get()).reader; return { theme: s.theme, chosen: s.themeChosen }; });
    check('chosen-stays', t4 === 'white' && stored.theme === 'white' && stored.chosen === true, `after Dunkel: ${t4} stored=${JSON.stringify(stored)}`);
    await page.evaluate(() => document.querySelector('.rd-settings .rd-follow')?.click()); await sleep(400);
    const t5 = await rootTheme();
    check('follow-again', t5 === 'night', `switch on with Dunkel → ${t5}`);
    await page.keyboard.press('Escape'); await sleep(300);
    await setUi('sepia');
  }

  // ---- night pages of a chess book: the diagrams keep their colours (found on the page while the reader idles)
  if (chess) {
    await setReader({ theme: 'night', themeChosen: true });
    await openAt0(chess);
    await page.evaluate(() => document.querySelector('.rd-view').goTo(3));
    const kept = await page.waitForFunction(() => {
      const docs = (document.querySelector('.rd-view')?.renderer?.getContents?.() || []).map((c) => c.doc).filter(Boolean);
      const d = docs.find((x) => x.querySelector('#canvas > canvas')?.pageIndex === 3);
      return d && d.querySelectorAll('.rd-keep > canvas').length > 0;
    }, null, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.mouse.move(5, 300); await sleep(3000);
    const img = await shotImg('pc-chess-night');
    const pr = await pageRect(3);
    const board = ptRegion(img, pr, 432, 100, 134, 232, 232);   // the vector diagram of page 4 (generator: 96, 130, 240)
    const text = ptRegion(img, pr, 432, 54, 400, 324, 120);
    check('night-diagram-kept', kept && board.p50 > 120 && text.p50 < 70, `overlay ${kept}, board p50=${board.p50} (natural, dimmed), text area p50=${text.p50} (night)`);
  }

  // ---- turning PDF pages: white against night (same book, same conditions)
  if (chess) {
    const times = {};
    for (const theme of ['white', 'night', 'white', 'night']) {
      await setReader({ theme, themeChosen: true });
      await openAt0(chess);
      const ms = [];
      for (let i = 0; i < 4; i++) {
        ms.push(await page.evaluate(async () => {
          const v = document.querySelector('.rd-view');
          const canv = () => v.renderer.getContents().map((c) => c.doc?.querySelector('#canvas > canvas'));
          const before = new Set(canv());
          const t0 = performance.now();
          v.goRight();
          for (;;) {
            await new Promise((r) => requestAnimationFrame(r));
            const cs = canv();
            if (cs.length && cs.every((c) => c && !before.has(c) && c.imageRects)) break;
            if (performance.now() - t0 > 8000) break;
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return performance.now() - t0;
        }));
      }
      (times[theme] ||= []).push(...ms);
    }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const w = mean(times.white), n = mean(times.night);
    check('turn-time', n <= w * 1.35 + 25, `white ${w.toFixed(0)} ms, night ${n.toFixed(0)} ms per page turn (${JSON.stringify(Object.fromEntries(Object.entries(times).map(([a, b]) => [a, b.map((x) => Math.round(x))])))})`);
  }
  await k.closeAll();
  await setReader({ theme: 'paper', themeChosen: false });
  const errs = k.errors.filter((e) => !/Failed to load resource/.test(e));
  check('no-errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  log(`SUMMARY page-color-check: ${pass} passed, ${fail} failed`);
};
