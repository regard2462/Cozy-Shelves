// Audit: Fernleihe against the live services. Every drawer is browsed and searched, covers are counted,
// "Jetzt lesen" opens the reader, one EPUB is downloaded into the library, "Webseite als Buch" reads a page.
// Needs an auto folder in COZYSHELVES_BOOKS (downloads land in <auto>/Online-Katalog/<Quelle>).
const kit = require('./audit-lib');

const QUERY = { gutenberg: 'Dickens', standardebooks: 'Austen', 'gutenberg-de': 'Goethe', wikisource: 'Faust', wikibooks: 'Schach', archive: 'Faust', openlibrary: 'Kafka', oapen: 'history', librivox: 'Sherlock', arxiv: 'quantum computing', zeno: 'Goethe' };

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  await k.open('catalog', {}, 4000);
  const sources = await page.evaluate(() => [...document.querySelectorAll('.cat-drawer')].map((d) => d.querySelector('.cat-drawer-name')?.textContent));
  log('SOURCES ' + JSON.stringify(sources));
  const settle = async (maxMs = 45000) => {
    const t0 = Date.now();
    for (;;) {
      const st = await page.evaluate(() => ({ spinner: !!document.querySelector('.cat-results .cat-state .cat-spinner'), cards: document.querySelectorAll('.cat-card').length, state: document.querySelector('.cat-results .cat-state')?.innerText.replace(/\s+/g, ' ').slice(0, 220) || null, note: document.querySelector('.cat-note')?.textContent || null, foot: document.querySelector('.cat-count')?.textContent || null }));
      if (!st.spinner || Date.now() - t0 > maxMs) return { ...st, ms: Date.now() - t0 };
      await sleep(700);
    }
  };
  const covers = () => page.evaluate(() => { const imgs = [...document.querySelectorAll('.cat-card .cat-cover')]; return { real: imgs.filter((i) => i.naturalWidth > 2 && !i.src.startsWith('data:')).length, typographic: imgs.filter((i) => i.src.startsWith('data:')).length, cards: document.querySelectorAll('.cat-card').length }; });
  // AUDIT_PART=read skips browsing every drawer and goes straight to reading, downloading and "Webseite als Buch"
  const ids = process.env.AUDIT_PART === 'read' ? [] : await page.evaluate(() => [...document.querySelectorAll('.cat-drawer')].map((d, i) => i));
  for (const i of ids) {
    k.newErrors();
    await page.evaluate((n) => document.querySelectorAll('.cat-drawer')[n].click(), i);
    await sleep(600);
    const name = await page.evaluate(() => document.querySelector('.cat-source-name')?.textContent);
    const browse = await settle();
    await sleep(2500);
    const cv = await covers();
    await shot(`c-${i}-browse`);
    const srcId = await page.evaluate(() => { const act = document.querySelector('.cat-drawer.active'); return act ? [...document.querySelectorAll('.cat-drawer')].indexOf(act) : -1; });
    void srcId;
    const isUrl = await page.evaluate(() => document.querySelector('.cat-search')?.type === 'url');
    let search = null;
    if (!isUrl) {
      const q = Object.values(QUERY)[i] || 'Goethe';
      await page.evaluate((qq) => { const inp = document.querySelector('.cat-search'); inp.value = qq; inp.closest('form').requestSubmit(); }, q);
      await sleep(500);
      search = await settle();
      search.q = q;
    }
    log(`SOURCE ${i} ${name} browse=${JSON.stringify(browse)} covers=${JSON.stringify(cv)} search=${JSON.stringify(search)} errors=${JSON.stringify(k.newErrors().slice(0, 3))}`);
  }

  // ---- "Jetzt lesen" on the first Standard Ebooks card: the reader opens with the book --------------------------------
  // (Standard Ebooks answers reliably; the Gutenberg API is sometimes slower than the 20 s limit)
  await page.evaluate(() => document.querySelectorAll('.cat-drawer')[1].click());
  await sleep(600); await settle();
  for (let t = 0; t < 30 && !(await page.evaluate(() => [...document.querySelectorAll('.cat-card .btn')].some((x) => /Jetzt lesen|Read now/.test(x.textContent)))); t++) await sleep(1000);
  const readBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('.cat-card .btn')].find((x) => /Jetzt lesen|Read now/.test(x.textContent)); if (!b) return null; const t = b.closest('.cat-card').querySelector('.cat-card-title')?.textContent; b.click(); return t; });
  let reader = null;
  for (let t = 0; t < 60; t++) {
    reader = await page.evaluate(() => { const r = document.querySelector('.rd-root'); if (!r) return null; return { title: document.querySelector('.rd-title')?.textContent, loading: !!document.querySelector('.rd-loading'), error: document.querySelector('.rd-error')?.innerText.slice(0, 160) || null, page: document.querySelector('.rd-page')?.textContent }; });
    if (reader && !reader.loading) break;
    await sleep(1000);
  }
  log('READ-NOW ' + readBtn + ' → ' + JSON.stringify(reader));
  await shot('c-read-now');
  await page.keyboard.press('Escape'); await sleep(1200);
  log('STACK after reader ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#panels .panel-layer:not(.closing)')].map((l) => l.dataset.panel))));
  // Esc closes the reader and leads back to the Fernleihe
  await page.keyboard.press('Escape'); await sleep(900);
  log('STACK after Esc ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#panels .panel-layer:not(.closing)')].map((l) => l.dataset.panel))));

  // ---- download one Standard Ebooks EPUB into the library ---------------------------------------------------------
  await page.evaluate(() => document.querySelectorAll('.cat-drawer')[1].click());
  await sleep(600); await settle();
  const dl = await page.evaluate(() => { const b = [...document.querySelectorAll('.cat-card .btn.primary')].find((x) => /In die Bücherei|Add to library/.test(x.textContent)); if (!b) return null; const t = b.closest('.cat-card').querySelector('.cat-card-title')?.textContent; b.click(); return t; });
  let prog = null;
  for (let t = 0; t < 90; t++) {
    prog = await page.evaluate(() => document.querySelector('.cat-progress:not([hidden])')?.innerText.replace(/\s+/g, ' ') || null);
    if (prog && /Regal|shelf|⚠/.test(prog)) break;
    await sleep(1000);
  }
  log('DOWNLOAD ' + dl + ' → ' + prog);
  await shot('c-download');
  await sleep(6000);
  const inLib = await page.evaluate((t) => window.__app.state.library.books.filter((b) => t && (b.title || '').toLowerCase().includes(t.toLowerCase().slice(0, 12))).map((b) => ({ t: b.title, rel: b.relPath, d: b.department })), dl);
  log('IN-LIBRARY ' + JSON.stringify(inLib));

  // ---- "Webseite als Buch" ---------------------------------------------------------------------------------------------
  const webIdx = await page.evaluate(() => [...document.querySelectorAll('.cat-drawer')].findIndex((d) => /Webseite|Web page/i.test(d.textContent)));
  await page.evaluate((n) => document.querySelectorAll('.cat-drawer')[n].click(), webIdx);
  await sleep(1000);
  await page.evaluate(() => { const inp = document.querySelector('.cat-search'); inp.value = 'https://de.wikipedia.org/wiki/Lesesaal'; inp.closest('form').requestSubmit(); });
  const web = await settle();
  log('WEB ' + JSON.stringify(web));
  await shot('c-web');
  const webRead = await page.evaluate(() => { const b = [...document.querySelectorAll('.cat-card .btn')].find((x) => /Jetzt lesen|Read now/.test(x.textContent)); if (!b) return 'no read button'; b.click(); return 'clicked'; });
  let wr = null;
  for (let t = 0; t < 40; t++) {
    wr = await page.evaluate(() => (document.querySelector('.rd-root') ? { title: document.querySelector('.rd-title')?.textContent, loading: !!document.querySelector('.rd-loading'), error: document.querySelector('.rd-error')?.innerText.slice(0, 160) || null } : null));
    if (wr && !wr.loading) break;
    await sleep(1000);
  }
  log('WEB-READ ' + webRead + ' → ' + JSON.stringify(wr));
  await shot('c-web-read');
  await k.closeAll();
  log('ALL-ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
  log('BAD-RESPONSES ' + JSON.stringify([...new Set(k.badResponses)].slice(0, 20), null, 1));
};
