// Check: scripted content of a book never runs. foliate-js renders every section of an EPUB in an iframe of the
// app's own origin with allow-scripts (its README: "it is imperative that you use CSP to block all scripts except
// 'self'"), and it hands every resource of the book, scripts included, to the section as a blob: URL. So the
// Content-Security-Policy of the app's documents (electron/main.js cspFor) must not allow blob: scripts, or a book could
// call window.api of the app through its parent window.
//   node build/testlib/make_scripted_epub.js <folder>
//   COZYSHELVES_BOOKS="<folder>|structured" COZYSHELVES_USERDATA=<new dir> node build/screenshot.js epub-script-check
module.exports = async (env) => {
  const kit = require('./audit-lib')(env);
  const { page, app, sleep, log } = kit;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const waitFor = async (fn, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(step); } };
  const marks = () => page.evaluate(() => {
    const out = {};
    for (const k of ['__epubScript', '__epubScriptTop', '__epubInline', '__epubHandler', '__epubLink']) if (window[k] !== undefined) out[k] = window[k];
    return out;
  });

  await kit.boot({ enter: false });
  const book = await waitFor(() => page.evaluate(() => window.__app.state.library.books.find((b) => /Ein Buch mit Skript/.test(b.path) && b.indexed) || null), 60000);
  check('the scripted EPUB is in the library and indexed', !!book, JSON.stringify(book && { id: book.id, title: book.title, indexed: book.indexed }));
  if (!book) { log(`EPUB-SCRIPT-CHECK ${pass}/${pass + fail} passed`); return; }
  // the hidden indexer window read the book with foliate-js as well: nothing of the book may have reached its window
  const indexerMarks = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => /indexer\.html/.test(x.webContents.getURL()));
    return w ? w.webContents.executeJavaScript("JSON.stringify(Object.fromEntries(['__epubScript','__epubScriptTop','__epubInline','__epubHandler'].filter((k) => window[k] !== undefined).map((k) => [k, window[k]])))") : 'null';
  });
  check('no script of the book ran in the indexer window', indexerMarks === '{}' || indexerMarks === 'null', indexerMarks);

  await page.evaluate((id) => window.__app.openPanel('reader', { id }), book.id);
  // the sections of foliate-js are blob: iframes inside a closed shadow root: Playwright's frame tree still sees them
  const sectionText = async () => {
    for (const f of page.frames()) {
      if (!/^blob:/.test(f.url())) continue;
      try { const t = await f.evaluate(() => document.body?.textContent || ''); if (/Hallo aus dem Buch/.test(t)) return t; } catch { /* a frame on its way */ }
    }
    return null;
  };
  const shown = await waitFor(sectionText, 30000);
  check('the reader shows the text of the book (the section is rendered)', !!shown, shown ? `${page.frames().filter((f) => /^blob:/.test(f.url())).length} blob: frames` : 'no section frame with the text');
  await sleep(4000);   // scripts, handlers and the deferred load of the image would have run by now
  const m = await marks();
  check('the external script of the book did not run', !m.__epubScript && !m.__epubScriptTop, JSON.stringify(m));
  check('the inline script of the book did not run', !m.__epubInline, JSON.stringify(m));
  check('the event handler attribute of the book did not run', !m.__epubHandler, JSON.stringify(m));
  // the reader's own work in the section still happens (CFIs, highlights, read-aloud reach into the document)
  const title = await page.evaluate(() => document.querySelector('.rd-title')?.textContent || '');
  check('the reader names the book', /Ein Buch mit Skript/.test(title), JSON.stringify(title));
  await kit.closeAll();
  const errs = kit.newErrors().filter((e) => !/Content Security Policy|Refused to (load|execute)/.test(e));
  check('no errors of the page but the refused scripts', errs.length === 0, errs.slice(0, 3).join(' | '));
  log(`EPUB-SCRIPT-CHECK ${pass}/${pass + fail} passed`);
};
