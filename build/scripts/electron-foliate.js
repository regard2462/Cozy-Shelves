module.exports = async ({ win, shot, sleep }) => {
  const page = win;
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 180000 });
  await page.evaluate(() => { window.__app.world.stop(); });
  const r = await page.evaluate(async () => {
    const out = []; const t = (m) => out.push(m + ' @' + Math.round(performance.now()));
    try {
      const books = window.__app.state.library.books; const b = books.find((x) => x.format === 'epub');
      const url = await window.api.library.bookUrl(b.id); t('url ' + url);
      const res = await fetch(url); t('fetch status ' + res.status + ' ' + res.headers.get('content-type')); const blob = await res.blob(); t('blob ' + blob.size);
      const VENDOR = new URL('vendor/foliate-js/', document.baseURI).href;
      const mod = await import(VENDOR + 'view.js'); t('view.js loaded');
      const book = await mod.makeBook(url); t('makeBook ok sections=' + book.sections.length + ' title=' + JSON.stringify(book.metadata?.title));
      const view = document.createElement('foliate-view'); document.body.appendChild(view); view.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:#fff;z-index:99';
      let relocated = false; view.addEventListener('relocate', (e) => { relocated = true; t('relocate ' + JSON.stringify({ fraction: e.detail.fraction, cfi: e.detail.cfi })); });
      view.addEventListener('load', (e) => t('load section ' + e.detail.index));
      await view.open(book); t('view.open ok fixed=' + view.isFixedLayout);
      const p = view.init({ showTextStart: true }); const to = new Promise((r) => setTimeout(() => r('timeout'), 15000));
      const res2 = await Promise.race([p.then(() => 'init ok'), to]); t(res2);
      await new Promise((r) => setTimeout(r, 1000)); t('relocated=' + relocated);
    } catch (e) { t('ERROR ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')); }
    return out;
  });
  console.log(r.join('\n'));
  await shot('el-foliate');
};
