// Drives the Fernleihe (catalog panel) and the in-app reading browser in a real Electron window.
//   node build/screenshot.js catalog-browser
// Checks: cards render covers and a "Jetzt lesen" button for every source, the <webview> of the
// browser panel really loads a page, reader mode produces text.
module.exports = async ({ win, shot, sleep }) => {
  const page = win;
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(400);
  await page.evaluate(() => window.__app.openPanel('catalog', {}));
  await page.waitForSelector('.cat-panel', { timeout: 30000 });
  await sleep(1200);
  await shot('cat-00-open');

  const drawers = await page.evaluate(() => [...document.querySelectorAll('.cat-drawer')].map((b) => b.querySelector('.cat-drawer-name').textContent));
  console.log('sources:', drawers.join(' | '));

  // walk a few drawers and report what the cards offer
  const wanted = process.env.CAT_SOURCES ? process.env.CAT_SOURCES.split(',') : ['Project Gutenberg', 'Projekt Gutenberg-DE', 'Internet Archive', 'Open Library', 'arXiv', 'Zeno.org', 'Webseite als Buch', 'OAPEN / DOAB', 'Standard Ebooks'];
  for (const name of wanted) {
    const found = await page.evaluate((n) => {
      const b = [...document.querySelectorAll('.cat-drawer')].find((x) => x.querySelector('.cat-drawer-name').textContent.trim() === n);
      if (!b) return false;
      b.click();
      return true;
    }, name);
    if (!found) { console.log(name, '– drawer not found'); continue; }
    await sleep(9000);
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.cat-card')];
      const btns = cards.map((c) => [...c.querySelectorAll('.cat-card-actions .btn')].map((b) => b.textContent.trim()));
      const covers = cards.map((c) => {
        const img = c.querySelector('img.cat-cover');
        return img ? (img.complete && img.naturalWidth > 1 ? 'img' : 'img-pending') : (c.querySelector('.cat-cover-ph') ? 'placeholder' : 'none');
      });
      const note = document.querySelector('.cat-note')?.textContent?.slice(0, 120) || '';
      const err = document.querySelector('.cat-err')?.textContent?.slice(0, 160) || '';
      return { cards: cards.length, withRead: btns.filter((b) => b.some((t) => /Jetzt lesen|Read now/.test(t))).length, covers, note, err, subjects: document.querySelectorAll('.cat-tag-more').length };
    });
    console.log(`${name}: ${info.cards} cards, ${info.withRead} with "Jetzt lesen", covers=${info.covers.join(',') || '-'}, "+N" chips=${info.subjects}${info.note ? ' | note: ' + info.note : ''}${info.err ? ' | ERROR: ' + info.err : ''}`);
    await shot('cat-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  }

  // the in-app browser
  await page.evaluate(() => [...document.querySelectorAll('.cat-header .btn')].find((b) => /Browser/.test(b.textContent))?.click());
  await page.waitForSelector('.br-panel', { timeout: 20000 });
  await sleep(1000);
  const hasView = await page.evaluate(() => !!document.querySelector('webview.br-view'));
  console.log('browser: <webview> present =', hasView);
  await page.evaluate(() => {
    const inp = document.querySelector('.br-address');
    inp.value = 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(7000);
  await shot('br-10-page');
  const state = await page.evaluate(() => ({
    url: document.querySelector('.br-address')?.value,
    title: document.querySelector('.br-status-title')?.textContent,
    fallback: !document.querySelector('.br-fallback')?.hidden,
  }));
  console.log('browser state:', JSON.stringify(state));

  // reader mode
  await page.evaluate(() => [...document.querySelectorAll('.br-bar .btn')].find((b) => /Lesemodus|Reader/.test(b.textContent))?.click());
  await sleep(9000);
  await shot('br-20-reader');
  const reader = await page.evaluate(() => ({
    title: document.querySelector('.br-reader-title')?.textContent || null,
    chars: (document.querySelector('.br-reader-body')?.textContent || '').length,
    state: document.querySelector('.br-reader-state')?.textContent?.slice(0, 140) || null,
  }));
  console.log('reader mode:', JSON.stringify(reader));

  // menu (bookmarks / history / save as book)
  await page.evaluate(() => [...document.querySelectorAll('.br-bar .btn')].find((b) => b.textContent.trim() === '☰')?.click());
  await sleep(600);
  await shot('br-30-menu');

  console.log(errs.length ? 'console errors: ' + errs.slice(0, 8).join(' || ') : 'no console errors');
};
