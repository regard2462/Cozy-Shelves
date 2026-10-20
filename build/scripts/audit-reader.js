// Audit: the reader with every format of the test library (books-fmt + testbooks4). Opens each book, turns
// pages, checks TOC, search, bookmarks, highlights, appearance settings, reopening at the last location and
// in-book links. Needs COZYSHELVES_BOOKS="<testbooks4>|structured;<books-fmt>|auto".
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  // wait for the auto folder to be indexed and classified
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, pending: b.filter((x) => !x.indexed).length }; });
    if (st.n >= 36 && !st.pending) break;
    await sleep(2000);
  }
  const lib = await page.evaluate(async () => (await window.api.library.getState()).books.map((b) => ({ id: b.id, f: b.format, t: b.title, a: b.author, l: b.language, d: b.department, s: b.shelf, p: b.pageCount, chess: !!b.isChess, cover: !!b.hasCover, rel: b.relPath })));
  for (const b of lib) log('BOOK ' + JSON.stringify(b));

  const frameText = () => page.evaluate(() => {
    const v = document.querySelector('.rd-view');
    const docs = (v?.renderer?.getContents?.() || []).map((c) => c.doc).filter(Boolean);
    return docs.map((d) => (d.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140)).join(' | ');
  });
  const readerState = () => page.evaluate(() => ({
    page: document.querySelector('.rd-page')?.textContent || '', pct: document.querySelector('.rd-percent')?.textContent || '',
    chapter: document.querySelector('.rd-chapter')?.textContent || '', title: document.querySelector('.rd-title')?.textContent || '',
    error: document.querySelector('.rd-error')?.innerText?.replace(/\s+/g, ' ').slice(0, 200) || null,
    loading: !!document.querySelector('.rd-loading'), chess: !document.querySelector('.rd-chess')?.classList.contains('hidden'),
  }));
  const pick = (pred) => lib.find(pred);
  const cases = [
    ['txt', pick((b) => b.f === 'txt' && /Regen/.test(b.t))], ['txt-long', pick((b) => b.f === 'txt' && /Äpfel/.test(b.t))], ['txt-en', pick((b) => b.f === 'txt' && /Lighthouse/.test(b.t))],
    ['md', pick((b) => b.f === 'md')], ['html', pick((b) => b.f === 'html')], ['docx', pick((b) => b.f === 'docx')], ['rtf', pick((b) => b.f === 'rtf')],
    ['epub', pick((b) => b.f === 'epub')], ['pdf', pick((b) => b.f === 'pdf')], ['chess-pdf', pick((b) => b.f === 'pdf' && b.chess)],
  ];
  for (const [name, b] of cases) {
    if (!b) { log(`CASE ${name}: no book`); continue; }
    k.newErrors();
    await k.open('reader', { id: b.id }, 6500);
    const s1 = await readerState();
    const t1 = await frameText();
    await shot(`r-${name}-1`);
    await page.keyboard.press('ArrowRight'); await sleep(1600);
    const s2 = await readerState();
    await shot(`r-${name}-2`);
    // table of contents
    await page.keyboard.press('t'); await sleep(700);
    const toc = await page.evaluate(() => [...document.querySelectorAll('.rd-toc-label, .rd-sb-pagebtn')].slice(0, 8).map((e) => e.textContent.trim()));
    await shot(`r-${name}-toc`);
    await page.keyboard.press('Escape'); await sleep(400);
    log(`CASE ${name} "${b.t}" p1=${JSON.stringify(s1)} text="${t1.slice(0, 100)}" p2=${s2.page}/${s2.pct} toc=${JSON.stringify(toc)} errors=${JSON.stringify(k.newErrors().slice(0, 3))}`);
    await page.keyboard.press('Escape'); await sleep(900);
  }

  // ---- deep checks on the TXT book: bookmark, search, highlight, settings, reopen ------------------------------
  const txt = cases[0][1];
  await k.open('reader', { id: txt.id }, 6000);
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await sleep(900); }
  await page.keyboard.press('b'); await sleep(900);
  const bm = await page.evaluate(async (id) => (await window.api.library.book(id)).bookmarks, txt.id);
  log('BOOKMARKS ' + JSON.stringify(bm.map((x) => x.label)));
  // search
  await page.keyboard.press('f'); await sleep(600);
  await page.keyboard.type('Gewitter'); await page.keyboard.press('Enter'); await sleep(3500);
  const search = await page.evaluate(() => ({ status: document.querySelector('.rd-sb-status')?.textContent, hits: document.querySelectorAll('.rd-sb-result').length }));
  log('SEARCH ' + JSON.stringify(search));
  await shot('r-txt-search');
  await page.evaluate(() => document.querySelector('.rd-sb-result')?.click()); await sleep(1500);
  await page.keyboard.press('Escape'); await sleep(400);
  // highlight: select the first sentence of the visible page and pick a colour
  const sel = await page.evaluate(async () => {
    const v = document.querySelector('.rd-view');
    const c = v.renderer.getContents()[0];
    const doc = c.doc;
    const p = [...doc.querySelectorAll('p')].find((x) => { const r = x.getBoundingClientRect(); return r.width && r.left >= 0 && r.left < doc.defaultView.innerWidth; });
    if (!p) return 'no paragraph';
    const range = doc.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, Math.min(40, p.firstChild.length));
    const s = doc.getSelection(); s.removeAllRanges(); s.addRange(range);
    doc.dispatchEvent(new PointerEvent('pointerdown')); doc.dispatchEvent(new PointerEvent('pointerup'));
    await new Promise((r) => setTimeout(r, 200));
    const tb = document.querySelector('.rd-seltool');
    return tb && !tb.classList.contains('hidden') ? 'toolbar' : 'no toolbar';
  });
  log('SELECTION ' + sel);
  await shot('r-txt-toolbar');
  await page.evaluate(() => document.querySelector('.rd-tb-color')?.click()); await sleep(1200);
  const ann = await page.evaluate(async (id) => (await window.api.library.book(id)).annotations.map((a) => a.text.slice(0, 30)), txt.id);
  log('ANNOTATIONS ' + JSON.stringify(ann));
  // dictionary lookup on a single word
  const dict = await page.evaluate(async () => {
    const v = document.querySelector('.rd-view');
    const doc = v.renderer.getContents()[0].doc;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode())) { const i = node.data.indexOf('Bibliothek'); if (i >= 0) { const r = node.parentElement.getBoundingClientRect(); if (r.left >= 0 && r.left < doc.defaultView.innerWidth) { const range = doc.createRange(); range.setStart(node, i); range.setEnd(node, i + 10); const s = doc.getSelection(); s.removeAllRanges(); s.addRange(range); break; } } }
    doc.dispatchEvent(new PointerEvent('pointerdown')); doc.dispatchEvent(new PointerEvent('pointerup'));
    await new Promise((r) => setTimeout(r, 250));
    const btn = [...document.querySelectorAll('.rd-tb')].find((b) => b.title === 'Wörterbuch' || b.title === 'Dictionary');
    if (!btn) return 'no dict button';
    btn.click();
    await new Promise((r) => setTimeout(r, 6000));
    return document.querySelector('.rd-card')?.innerText.replace(/\s+/g, ' ').slice(0, 200) || 'no card';
  });
  log('DICT ' + dict);
  await shot('r-txt-dict');
  const trans = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('.rd-tb')].find((b) => b.title === 'Übersetzen');
    const doc = document.querySelector('.rd-view').renderer.getContents()[0].doc;
    doc.dispatchEvent(new PointerEvent('pointerdown')); doc.dispatchEvent(new PointerEvent('pointerup'));
    await new Promise((r) => setTimeout(r, 250));
    if (!btn) return 'no translate button';
    btn.click();
    await new Promise((r) => setTimeout(r, 6000));
    return document.querySelector('.rd-card')?.innerText.replace(/\s+/g, ' ').slice(0, 200) || 'no card';
  });
  log('TRANSLATE ' + trans);
  await shot('r-txt-translate');
  await page.keyboard.press('Escape'); await sleep(300);
  // appearance: night theme, bigger font, persisted in the settings
  await page.keyboard.press('s'); await sleep(600);
  await shot('r-txt-settings');
  await page.evaluate(() => { [...document.querySelectorAll('.rd-swatch')].find((b) => /Nacht|Night/.test(b.textContent))?.click(); });
  await sleep(300);
  await page.evaluate(() => { [...document.querySelectorAll('.rd-seg')].find((b) => b.textContent === '+')?.click(); });
  await sleep(900);
  await shot('r-txt-night');
  await page.keyboard.press('Escape'); await sleep(300);
  // move well into the book, so that reopening at the start would show
  await page.evaluate(() => document.querySelector('.rd-view').goToFraction(0.62)); await sleep(1500);
  const locBefore = await page.evaluate(() => document.querySelector('.rd-page')?.textContent + ' ' + document.querySelector('.rd-percent')?.textContent);
  // close and reopen: the same place, the settings kept
  await page.keyboard.press('Escape'); await sleep(1500);
  const saved = await page.evaluate(async (id) => { const b = await window.api.library.book(id); const s = await window.api.settings.get(); return { loc: b.lastLocation, progress: b.progress, theme: s.reader?.theme, fontSize: s.reader?.fontSize }; }, txt.id);
  log('SAVED ' + JSON.stringify(saved));
  await k.open('reader', { id: txt.id }, 6000);
  const locAfter = await page.evaluate(() => document.querySelector('.rd-page')?.textContent + ' ' + document.querySelector('.rd-percent')?.textContent);
  log(`REOPEN before="${locBefore}" after="${locAfter}"`);
  await shot('r-txt-reopen');
  // reset appearance for later runs
  await page.evaluate(() => window.api.settings.set({ reader: { theme: 'paper', fontSize: 19 } }));
  await page.keyboard.press('Escape'); await sleep(1200);

  // ---- links in the HTML book: #anchor stays, https opens in the reading view, Alt+← goes back ----------------
  const html = cases[4][1];
  if (html) {
    await k.open('reader', { id: html.id }, 6000);
    const anchor = await page.evaluate(async () => {
      const doc = document.querySelector('.rd-view').renderer.getContents()[0].doc;
      const a = doc.querySelector('a[href="#teil2"]') || [...doc.querySelectorAll('a')].find((x) => /zweiten Teil/.test(x.textContent));
      if (!a) return 'no anchor link';
      a.click(); await new Promise((r) => setTimeout(r, 1500));
      return document.querySelector('.rd-page')?.textContent + ' / ' + document.querySelector('.rd-chapter')?.textContent;
    });
    log('ANCHOR ' + anchor);
    const img = await page.evaluate(() => { const docs = document.querySelector('.rd-view').renderer.getContents().map((c) => c.doc); for (const d of docs) for (const i of d.querySelectorAll('img')) return { src: i.getAttribute('src').slice(0, 40), w: i.naturalWidth }; return 'no img'; });
    log('HTML-IMAGE ' + JSON.stringify(img));
    await page.evaluate(() => document.querySelector('.rd-view').goTo(0)); await sleep(1500);
    const local = await page.evaluate(async () => {
      const doc = document.querySelector('.rd-view').renderer.getContents()[0].doc;
      const a = [...doc.querySelectorAll('a')].find((x) => /Nachbarseite/.test(x.getAttribute('href') || ''));
      if (!a) return 'no local link';
      a.click(); await new Promise((r) => setTimeout(r, 4000));
      const d2 = document.querySelector('.rd-view').renderer.getContents()[0].doc;
      const i = d2.querySelector('img');
      return { title: document.querySelector('.rd-title')?.textContent, crumbs: document.querySelector('.rd-crumbs')?.innerText.replace(/\s+/g, ' '), img: i ? i.naturalWidth : 'none', err: document.querySelector('.rd-linkerr')?.innerText.replace(/\s+/g, ' ').slice(0, 160) || null };
    });
    log('LOCAL-LINK ' + JSON.stringify(local));
    await shot('r-html-local');
    await page.keyboard.press('Alt+ArrowLeft'); await sleep(3000);
    log('LOCAL-BACK ' + JSON.stringify(await readerState()));
    const ext = await page.evaluate(async () => {
      const doc = document.querySelector('.rd-view').renderer.getContents()[0].doc;
      const a = [...doc.querySelectorAll('a')].find((x) => /example\.org/.test(x.getAttribute('href') || ''));
      if (!a) return 'no external link';
      a.click(); await new Promise((r) => setTimeout(r, 7000));
      return { title: document.querySelector('.rd-title')?.textContent, crumbs: document.querySelector('.rd-crumbs')?.innerText.replace(/\s+/g, ' '), err: document.querySelector('.rd-linkerr')?.innerText.slice(0, 120) || null };
    });
    log('EXTERNAL ' + JSON.stringify(ext));
    await shot('r-html-external');
    await page.keyboard.press('Alt+ArrowLeft'); await sleep(3000);
    log('BACK ' + JSON.stringify(await readerState()));
    await shot('r-html-back');
    await page.keyboard.press('Escape'); await sleep(1200);
  }
  // ---- Markdown: a (#slug) link finds its heading ---------------------------------------------------------------
  const md = cases[3][1];
  if (md) {
    await k.open('reader', { id: md.id }, 6000);
    const mdAnchor = await page.evaluate(async () => {
      const v = document.querySelector('.rd-view');
      const doc = v.renderer.getContents()[0].doc;
      const a = [...doc.querySelectorAll('a')].find((x) => (x.getAttribute('href') || '') === '#abschnitt-zwei');
      if (!a) return 'no md anchor';
      let target = null;
      v.addEventListener('relocate', (e) => { target = e.detail.range?.startContainer?.parentElement?.textContent?.slice(0, 30); }, { once: true });
      a.click(); await new Promise((r) => setTimeout(r, 1500));
      return { chapter: document.querySelector('.rd-chapter')?.textContent, rangeStart: target };
    });
    log('MD-ANCHOR ' + JSON.stringify(mdAnchor));
    await page.keyboard.press('Escape'); await sleep(1000);
  }
  log('ALL-ERRORS ' + JSON.stringify(k.errors.slice(0, 30), null, 1));
  log('BAD-RESPONSES ' + JSON.stringify([...new Set(k.badResponses)].slice(0, 30), null, 1));
};
