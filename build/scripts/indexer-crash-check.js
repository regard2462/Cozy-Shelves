// Check: the page of the hidden indexer window dies (a crash of the renderer, out of memory on a broken PDF) and the
// window comes back by itself (electron/main.js createIndexerWindow): the book it was reading counts as a failed try,
// the next books are read by the new page, and the main process can decode pictures again. Without the recovery every
// later book waited for the index timeout (a minute and more each) and was given up after three of them.
//   COZYSHELVES_BOOKS="<library>|structured" COZYSHELVES_USERDATA=<new dir> node build/screenshot.js indexer-crash-check
module.exports = async (env) => {
  const kit = require('./audit-lib')(env);
  const { page, app, sleep, log } = kit;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const waitFor = async (fn, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(step); } };
  const indexer = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /indexer\.html/.test(x.webContents.getURL()));
    return w ? { id: w.id, crashed: w.webContents.isCrashed(), pid: w.webContents.getOSProcessId() } : null;
  });
  const bookOf = (id) => page.evaluate((x) => window.api.library.book(x), id);

  await kit.boot({ enter: false });   // waits for the scan of the library, the indexer has read every book
  const before = await indexer();
  check('the indexer window exists after the scan', !!before && !before.crashed, JSON.stringify(before));
  const books = await page.evaluate(() => window.__app.state.library.books.filter((b) => b.indexed && !b.missing).map((b) => ({ id: b.id, format: b.format, size: b.size, title: b.title })));
  const small = books.filter((b) => b.format === 'epub' || b.format === 'pdf').sort((a, b) => a.size - b.size);
  const book = small[0] || books[0];
  check('a small book to read again', !!book, JSON.stringify(book));
  if (!before || !book) { log(`INDEXER-CRASH-CHECK ${pass}/${pass + fail} passed`); return; }

  // the page of the indexer dies while nothing is read
  await app.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id).webContents.forcefullyCrashRenderer(); }, before.id);
  await sleep(1500);
  log('INDEXER after the crash ' + JSON.stringify(await indexer()));
  // a book read again: a dead page never answers, and the index timeout takes a minute at least
  let t0 = Date.now();
  await page.evaluate((id) => window.api.library.reindex(id), book.id);
  let done = await waitFor(async () => { const b = await bookOf(book.id); return b && b.indexed ? b : null; }, 45000);
  check('a book is read again within 45 s after the page of the indexer died', !!done, `${Date.now() - t0} ms, indexError ${JSON.stringify(done?.indexError ?? null)}`);
  const after = await indexer();
  check('the indexer window is back with a live page', !!after && !after.crashed, JSON.stringify(after));
  check('the same window, a new renderer process', !!after && after.id === before.id && after.pid > 0 && after.pid !== before.pid, JSON.stringify({ before, after }));

  // the page dies while it reads a book: that try fails, the book is read again by the new page
  const second = small[1] || book;
  t0 = Date.now();
  await page.evaluate((id) => window.api.library.reindex(id), second.id);
  await sleep(150);
  await app.evaluate(({ BrowserWindow }, id) => { const w = BrowserWindow.fromId(id); if (w && !w.webContents.isCrashed()) w.webContents.forcefullyCrashRenderer(); }, before.id);
  done = await waitFor(async () => { const b = await bookOf(second.id); return b && b.indexed ? b : null; }, 45000);
  check('a book whose reading the crash interrupted is read again within 45 s', !!done, `${Date.now() - t0} ms, indexError ${JSON.stringify(done?.indexError ?? null)}`);
  const scan = await waitFor(() => page.evaluate(() => { const s = window.__app.state.library.scan; return s && !s.active ? s : null; }), 20000);
  check('the scan ends idle', !!scan, JSON.stringify(scan));
  // the page comes back after the second crash as well (its reload begins half a second after the crash)
  const last = await waitFor(async () => { const w = await indexer(); return w && !w.crashed && w.pid > 0 ? w : null; }, 20000);
  check('one indexer window, alive', !!last && (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((x) => /indexer\.html/.test(x.webContents.getURL())).length)) === 1, JSON.stringify(last));
  // and it decodes pictures again (the covers from the internet need it): the decoder answers within the time of a job
  const decoded = await page.evaluate(() => window.api.invoke('covers:status').then((s) => s && typeof s === 'object'));
  check('the main process answers after the crashes', decoded === true);
  log(`INDEXER-CRASH-CHECK ${pass}/${pass + fail} passed`);
};
