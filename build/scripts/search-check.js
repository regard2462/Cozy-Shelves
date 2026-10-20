// Check: the full-text search (electron/search, app/src/search, app/src/ui/search, app/src/ui/reader/reader-hit.js).
//
//   python build/testlib/gen_search_lib.py small <folder>            (a fresh library for every first phase: it changes it)
//   COZYSHELVES_BOOKS="<folder>|structured" COZYSHELVES_USERDATA=<new dir> COZYSHELVES_FULLTEXT_DELAY=0 node build/screenshot.js search-check
//   SEARCH_PHASE=restart with the same COZYSHELVES_USERDATA                 the index survives, the long book goes on where it stopped
//   SEARCH_LIB=large on `gen_search_lib.py large <folder> <books2\lib-master>`   indexing speed, query times, memory, disk size
//   SEARCH_PHASE=perf on a fresh small library: the world's frame times at the glass front while the long book is
//                read and while the index is switched off, in turns (PERF_ROUNDS, default 3)
//   SEARCH_PHASE=mem after the large run (same COZYSHELVES_USERDATA): memory of the main process and the indexer with the
//                index open and idle, after queries, and with the full-text search switched off
//   SEARCH_PHASE=shots on a library indexed by phase 1: the panel empty, with hits, in Dunkel and in English
//
// Phase 1: the index completes (one scan without text), every query of search-truth.json finds its books and pages,
// the filters, the panel (key T, typing, ↓ and Enter, Esc back to the results), a hit opens the reader at its page with
// the words marked (PDF text layer, EPUB with print pages, TXT), Strg+F in the reader, a hit only peeked at keeps the
// reading position, a changed book is read again, a removed one leaves the index, a moved one keeps its pages, a new
// long book is read and pauses while the reader is open, the settings rows; the app closes while the long book is read.
// SEARCH_PARTS=index,queries,filters,panel,reader,keys,peek,changes,pause,settings limits phase 1.
const fs = require('fs');
const path = require('path');
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log, shot, app } = k;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const phase = process.env.SEARCH_PHASE || (process.env.SEARCH_LIB === 'large' ? 'large' : '1');
  const parts = new Set((process.env.SEARCH_PARTS || 'index,queries,filters,panel,reader,keys,peek,changes,pause,settings').split(','));
  const lib = (process.env.COZYSHELVES_BOOKS || '').split('|')[0];
  const truth = JSON.parse(fs.readFileSync(path.join(lib, 'search-truth.json'), 'utf8'));
  const outDir = process.env.SHOT_DIR || 'shots';
  const stateFile = path.join(outDir, 'search-phase1.json');

  const status = (detail = false) => page.evaluate((d) => window.api.invoke('fulltext:status', d ? { detail: true } : undefined), detail);
  const search = (q, opts = {}) => page.evaluate(([x, o]) => window.api.invoke('fulltext:search', { q: x, ...o }), [q, opts]);
  const books = () => page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, path: b.path, title: b.title, relPath: b.relPath })));
  const rel = (p) => String(p || '').replace(/\\/g, '/');
  let byRel = new Map();
  const refreshBooks = async () => { byRel = new Map((await books()).map((b) => [rel(b.relPath), b])); };
  const idOf = (key) => byRel.get(truth.books[key])?.id || null;
  const waitFor = async (fn, ms, step = 500) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(step); } };
  // working sets in MB: the main process, the library's indexer window, the full-text reading window (0 when closed)
  const memory = () => app.evaluate(({ app: a, BrowserWindow }) => {
    const pidOf = (rx) => BrowserWindow.getAllWindows().find((w) => rx.test(w.webContents.getURL()))?.webContents.getOSProcessId();
    const ipid = pidOf(/indexer\.html/), tpid = pidOf(/fulltext\.html/);
    const m = a.getAppMetrics();
    const mb = (x) => Math.round((x?.memory?.workingSetSize || 0) / 1024);
    return { main: mb(m.find((x) => x.type === 'Browser')), indexer: mb(m.find((x) => x.pid === ipid)), reader: tpid ? mb(m.find((x) => x.pid === tpid)) : 0 };
  });
  const panels = () => page.evaluate(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel));
  const showChrome = async () => { await page.mouse.move(800, 300); await sleep(80); await page.mouse.move(806, 30); await sleep(500); };

  await k.boot();
  await refreshBooks();
  log('BOOKS ' + byRel.size);

  // ------------------------------------------------------------------------------------------------ phase: shots
  if (phase === 'shots') {
    await waitFor(async () => { const s = await status(); return s.total && s.done >= s.total; }, 240000, 1000);
    await page.evaluate(() => window.__app.world.start());
    await k.closeAll();
    await k.open('search', { q: '' }, 1500);
    await shot('search-empty');
    const tip = await page.evaluate(() => { const b = document.querySelector('.fts-example'); b?.click(); return b?.textContent; });
    await page.waitForFunction(() => document.querySelectorAll('.fts-book').length > 0 || document.querySelector('.fts-note'), null, { timeout: 8000 }).catch(() => {});
    check('tip-example-searches', (await page.evaluate(() => document.querySelector('.fts-input').value)) === tip, `${tip}`);
    await page.evaluate(() => { const i = document.querySelector('.fts-input'); i.value = 'Quastenflosser Bücher'; i.dispatchEvent(new Event('input')); });
    await sleep(1500);
    await shot('search-two-books');
    await page.evaluate(() => window.api.settings.set({ ui: { theme: 'dark' } }));
    await sleep(900);
    await shot('search-dark');
    await page.evaluate(() => window.api.settings.set({ language: 'en' }));
    await sleep(900);
    const en = await page.evaluate(() => ({ head: document.querySelector('.fts-panel .panel-header')?.textContent, status: document.querySelector('.fts-status-text')?.textContent, hit: document.querySelector('.fts-page')?.textContent, count: document.querySelector('.fts-count')?.textContent }));
    check('english-panel', /Full-text search/.test(en.head || '') && /books searched/.test(en.status || '') && /^p\. \d+|^loc\. \d+/.test(en.hit || '') && /hits? in/.test(en.count || ''), JSON.stringify(en));
    await shot('search-english');
    await page.evaluate(() => window.api.settings.set({ language: 'de', ui: { theme: 'sepia' } }));
    await sleep(700);
    log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (shots)`);
    return;
  }

  // ------------------------------------------------------------------------------------------------ phase: mem
  if (phase === 'mem') {
    await waitFor(async () => { const s = await status(); return s.ready && s.total && s.done >= s.total; }, 120000, 1000);
    await sleep(20000);
    const idle = await memory();
    for (const q of ['Zeit', 'Welt Leben', 'Spiel Turm König', '"der Turm"', 'Bauer*', 'Verteidigung', 'game history', 'Eröffnung Endspiel', 'Planwort0005', 'Stadt Land']) await search(q);
    await sleep(3000);
    const queried = await memory();
    await page.evaluate(() => window.api.settings.set({ fulltext: { enabled: false } }));
    await sleep(8000);
    const off = await memory();
    await page.evaluate(() => window.api.settings.set({ fulltext: { enabled: true } }));
    log(`MEM index open, idle: ${JSON.stringify(idle)}; after 10 queries: ${JSON.stringify(queried)}; full-text search off: ${JSON.stringify(off)}`);
    check('mem-main', queried.main - off.main < 300, `the index adds ${queried.main - off.main} MB to the main process (worker thread and SQLite)`);
    // MEM_REINDEX=<seconds>: build the index again for a while and follow the memory of the indexer window
    const secs = +process.env.MEM_REINDEX || 0;
    if (secs) {
      await page.evaluate(() => window.api.invoke('fulltext:rebuild'));
      const t0 = Date.now();
      let top = { main: 0, indexer: 0, reader: 0 };
      while (Date.now() - t0 < secs * 1000) {
        await sleep(30000);
        const m = await memory(), s = await status();
        top = { main: Math.max(top.main, m.main), indexer: Math.max(top.indexer, m.indexer), reader: Math.max(top.reader, m.reader) };
        log(`MEM reindex ${Math.round((Date.now() - t0) / 1000)} s: ${s.done}/${s.total} books, ${JSON.stringify(m)}`);
      }
      log(`MEM reindex max: ${JSON.stringify(top)} (indexer idle before: ${idle.indexer} MB)`);
    }
    log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (mem)`);
    return;
  }

  // ------------------------------------------------------------------------------------------------ phase: perf
  if (phase === 'perf') {
    await waitFor(async () => { const s = await status(); return s.total && s.done >= s.total; }, 180000, 500);
    const dst = path.join(lib, truth.books.long);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = path.join(lib, path.dirname(truth.extra.long), 'copy.pdf');
    fs.copyFileSync(path.join(lib, truth.extra.long), tmp);
    fs.renameSync(tmp, dst);
    const running = await waitFor(async () => { const s = await status(); return s.current && /lange Buch/.test(s.current.title || '') ? s : null; }, 90000, 300);
    check('perf-long-book-running', !!running, '');
    await k.closeAll();
    // the world in front, at the glass front looking into the garden (a heavy view), timed like gpu-perf.js
    await page.evaluate(() => {
      const w = window.__app.world;
      w.start();
      const p = w.player; p.transition = null; p.setPose(-2.5, -1.0, Math.PI - 0.8, 0);
      const P = window.__perf = { frames: [], cpu: [] };
      const orig = w.frame.bind(w);
      w.frame = () => { const a = performance.now(); orig(); P.cpu.push(performance.now() - a); };
      let last = 0;
      const tick = (t) => { if (last) P.frames.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), over33: s.filter((x) => x > 33.4).length }; };
    const rounds = +process.env.PERF_ROUNDS || 3;
    const agg = { on: { frames: [], cpu: [], pages: 0, secs: 0 }, off: { frames: [], cpu: [], pages: 0, secs: 0 } };
    for (let r = 0; r < rounds; r++) {
      for (const mode of ['on', 'off']) {
        await page.evaluate((on) => window.api.settings.set({ fulltext: { enabled: on } }), mode === 'on');
        await sleep(2500);
        const a = await status();
        await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.cpu.length = 0; });
        const ta = Date.now();
        await sleep(8000);
        const m = await page.evaluate(() => ({ frames: window.__perf.frames.slice(), cpu: window.__perf.cpu.slice() }));
        const b = await status();
        const pages = mode === 'on' && a.current && b.current && a.current.id === b.current.id ? b.current.unit - a.current.unit : 0;
        agg[mode].frames.push(...m.frames); agg[mode].cpu.push(...m.cpu); agg[mode].pages += pages; agg[mode].secs += (Date.now() - ta) / 1000;
        log(`PERF round ${r + 1} ${mode}: frame ${JSON.stringify(stats(m.frames))} cpu ${JSON.stringify(stats(m.cpu))} pages read ${pages} paused=${b.paused}`);
      }
    }
    const on = stats(agg.on.frames), off = stats(agg.off.frames), con = stats(agg.on.cpu), coff = stats(agg.off.cpu);
    log(`PERF index on : frame ${JSON.stringify(on)} cpu ${JSON.stringify(con)} ${Math.round(agg.on.pages / agg.on.secs)} pages/s`);
    log(`PERF index off: frame ${JSON.stringify(off)} cpu ${JSON.stringify(coff)}`);
    check('perf-frames', on.p95 <= off.p95 * 1.25 + 2, `p95 ${on.p95} ms with the index reading, ${off.p95} ms without`);
    await page.evaluate(() => window.api.settings.set({ fulltext: { enabled: true } }));
    log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (perf)`);
    return;
  }

  // ------------------------------------------------------------------------------------------------ phase: large
  if (phase === 'large') {
    const t0 = Date.now();
    let st = await status(), last = { t: Date.now(), done: 0 };
    let maxMem = { main: 0, indexer: 0, reader: 0 };
    for (;;) {
      st = await status(true);
      const mem = await memory();
      maxMem = { main: Math.max(maxMem.main, mem.main), indexer: Math.max(maxMem.indexer, mem.indexer), reader: Math.max(maxMem.reader, mem.reader) };
      if (Date.now() - last.t > 60000) { log(`progress ${st.done}/${st.total} books, ${Math.round((Date.now() - t0) / 1000)} s, mem ${JSON.stringify(mem)}, index ${Math.round(st.bytes / 1048576)} MB`); last = { t: Date.now(), done: st.done }; }
      if (st.total && st.done >= st.total) break;
      if (Date.now() - t0 > 4 * 3600000) break;
      await sleep(5000);
    }
    const secs = (Date.now() - t0) / 1000;
    const pagesIndexed = (st.books || []).reduce((a, b) => a + (b.kind === 'pdf' ? (b.units || 0) : (b.pages || 0)), 0);
    check('large-complete', st.done >= st.total, `${st.done}/${st.total} books, ${pagesIndexed} pages in ${Math.round(secs)} s = ${Math.round(pagesIndexed / secs)} pages/s overall (the library's own indexing included), index ${Math.round(st.bytes / 1048576)} MB on disk`);
    check('large-memory', maxMem.main < 400 && maxMem.reader < 450, `max working set: main ${maxMem.main} MB, indexer window ${maxMem.indexer} MB, reading window ${maxMem.reader} MB`);
    const times = [];
    for (const p of truth.planted || []) {
      const r = await search(p.q);
      const b = byRel.get(p.file);
      const ok = r.ok && r.books[0]?.id === b?.id && r.books[0]?.items?.some((x) => +x.page === p.page);
      times.push(r.ms);
      check('large-planted ' + p.q, ok, `${r.ms} ms page ${r.books[0]?.items?.map((x) => x.page).join(',')} want ${p.page}`);
    }
    for (const q of ['Zeit', 'Welt Leben', 'Spiel Turm König', '"der Turm"', 'Bauer*', 'Verteidigung', 'mererwertum', 'game history', 'Eröffnung Endspiel']) {
      const a = Date.now();
      const r = await search(q);
      const wall = Date.now() - a;
      times.push(r.ms);
      check('large-query ' + q, r.ok && r.ms < 1500, `${r.ms} ms in the index, ${wall} ms round trip, ${r.totalHits} hits in ${r.totalBooks} books`);
    }
    times.sort((x, y) => x - y);
    log(`QUERY-TIMES median ${times[times.length >> 1]} ms, max ${times[times.length - 1]} ms over ${times.length} queries`);
    await k.open('search', { q: 'Turm König' }, 2500);
    await shot('search-large-panel');
    await k.closeAll();
    log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (large)`);
    return;
  }

  // ------------------------------------------------------------------------------------------------ phase: restart
  if (phase === 'restart') {
    const before = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const st = await status(true);
    const longId = before?.longId;
    const row = (st.books || []).find((b) => b.id === longId);
    const doneRows = (st.books || []).filter((b) => b.state === 'done' || b.state === 'notext').length;
    check('restart-index-kept', doneRows >= (before?.doneRows || 1) && st.bytes > 0, `${doneRows} books still in the index (before ${before?.doneRows}), ${Math.round(st.bytes / 1024)} KB`);
    check('restart-long-partial', !!row && row.state === 'partial' && row.next >= (before?.longNext || 1), `long book ${row?.state} at page ${row?.next} (stopped at ${before?.longNext})`);
    // it goes on from there: the first page it reports is not 0, and in the end every page is there once
    let first = null;
    const t0 = Date.now();
    const done = await waitFor(async () => {
      const s = await status(true);
      if (first == null && s.current?.id === longId) first = s.current.unit;
      const r = (s.books || []).find((b) => b.id === longId);
      return r && r.state === 'done' ? r : null;
    }, 240000, 250);
    // `from`: the page the job of the long book started at in this run (not 0: it went on where it had stopped)
    check('restart-resumed', !!done && done.from >= (before?.longNext || 1), `started this run at page ${done?.from} (stopped at ${before?.longNext}; first seen at ${first}), finished in ${Math.round((Date.now() - t0) / 1000)} s with ${done?.pages} pages of ${done?.units}`);
    check('restart-no-duplicates', !!done && done.pages === done.units, `${done?.pages} pages with text, ${done?.units} pages`);
    const r = await search('Pfefferminzbonbon');
    check('restart-late-page', r.books[0]?.id === longId && r.books[0]?.items?.[0]?.page === '2000', `→ ${r.books[0]?.items?.map((x) => x.page)}`);
    for (const q of truth.queries.filter((x) => x.pages && !x.later).slice(0, 4)) {
      const res = await search(q.q);
      const id = idOf(q.book);
      const got = res.books.find((b) => b.id === id)?.items?.map((x) => +x.page) || [];
      check('restart-query ' + q.q, q.pages.slice(0, 3).every((p) => got.includes(p)), `pages ${got}`);
    }
    // "Index neu aufbauen": empty at once, complete again a little later
    const rb = await page.evaluate(() => window.api.invoke('fulltext:rebuild'));
    const after = await waitFor(async () => { const s = await status(); return s.done >= s.total && s.total ? s : null; }, 240000, 1000);
    check('rebuild', rb.done < rb.total && !!after, `right after: ${rb.done}/${rb.total}, then ${after?.done}/${after?.total}`);
    const again = await search('Quastenflosser');
    check('rebuild-query', again.books.length === 2, `${again.books.length} books`);
    log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (restart)`);
    log('errors: ' + JSON.stringify(k.errors.slice(0, 5)));
    return;
  }

  // ------------------------------------------------------------------------------------------------ phase 1
  // the index completes
  const t0 = Date.now();
  const st0 = await waitFor(async () => { const s = await status(); return s.total && s.done >= s.total ? s : null; }, 180000, 500);
  check('index-complete', !!st0 && st0.notext === 1, `${st0?.done}/${st0?.total} books in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${st0?.notext} without text, ${Math.round((st0?.bytes || 0) / 1024)} KB`);
  await refreshBooks();

  if (parts.has('queries')) {
    for (const q of truth.queries.filter((x) => !x.later)) {
      const r = await search(q.q);
      const ids = r.books.map((b) => b.id);
      let ok = r.ok;
      let info = `${r.ms} ms → ${r.books.map((b) => byRel.get([...byRel.keys()].find((kk) => byRel.get(kk).id === b.id))?.title).join(' | ')}`;
      if (q.books) ok = ok && ids.length === q.books.length && q.books.every((key) => ids.includes(idOf(key)));
      // a single book expected: it comes first; several: all of them and no other
      if (q.book && !q.books) ok = ok && ids[0] === idOf(q.book);
      if (q.pages) {
        const b = r.books.find((x) => x.id === idOf(q.book));
        const got = (b?.items || []).map((x) => +x.page);
        ok = ok && !!b && b.hits === q.pages.length && q.pages.slice(0, 3).every((p, i) => got[i] === p);
        info += ` pages ${got.join(',')} want ${q.pages.join(',')}`;
      }
      check('query ' + q.q, ok, info);
    }
    const flow = await search('Leuchtturm');
    const fh = flow.books[0]?.items?.[0];
    check('flow-hit-location', fh?.page === '18' && fh?.chapter === 'Kapitel 4' && fh?.loc?.s === 3 && fh?.loc?.o > 0, JSON.stringify({ page: fh?.page, pos: fh?.pos, chapter: fh?.chapter, loc: fh?.loc }));
    const nopl = await search('Windrad');
    const nh = nopl.books[0]?.items?.[0];
    check('flow-hit-position', !nh?.page && nh?.pos > 1 && nh?.chapter === 'Teil 3', JSON.stringify({ page: nh?.page, pos: nh?.pos, chapter: nh?.chapter }));
    const snip = (await search('Müller')).books[0]?.items?.[0]?.snippet;
    check('snippet-marks', !!snip && snip.marks.length >= 1 && snip.text.slice(...snip.marks[0]) === 'Müller', JSON.stringify(snip).slice(0, 160));
  }

  if (parts.has('filters')) {
    const dep = await search('Quastenflosser', { department: 'Romane' });
    check('filter-department', dep.books.length === 1 && dep.books[0].id === idOf('reise'), `${dep.books.length} books`);
    const de = await search('story', { language: 'de' });
    const en = await search('story', { language: 'en' });
    check('filter-language', de.books.length === 0 && en.books.length === 1 && en.books[0].id === idOf('bishop'), `de ${de.books.length}, en ${en.books.length}`);
  }

  // the panel: key T in the world, typing, ↓ and Enter opens a hit, Esc in the reader leads back to the results
  if (parts.has('panel')) {
    await k.closeAll();
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('t');
    await sleep(900);
    check('key-T', (await panels()).includes('search'), `panels ${await panels()}`);
    await page.keyboard.type('Läufer', { delay: 25 });
    await page.waitForFunction(() => document.querySelectorAll('.fts-hit').length >= 3, null, { timeout: 8000 }).catch(() => {});
    const view = await page.evaluate(() => ({ hits: [...document.querySelectorAll('.fts-hit')].map((x) => x.querySelector('.fts-page').textContent), status: document.querySelector('.fts-status-text')?.textContent, count: document.querySelector('.fts-count')?.textContent, marks: document.querySelectorAll('.fts-hit mark').length }));
    check('panel-results', view.hits.join(',') === 'S. 1,S. 3,S. 9' && view.marks >= 3 && new RegExp(`${st0?.total} von ${st0?.total} Büchern durchsucht, 1 ohne Text`).test(view.status), JSON.stringify(view));
    await shot('search-panel');
    // ↓ from the field: the book, S. 1, S. 3; Enter opens page 3
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await sleep(120); }
    const focused = await page.evaluate(() => document.activeElement?.querySelector?.('.fts-page')?.textContent || document.activeElement?.className);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Seite 3 von/.test(document.querySelector('.rd-page')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    const pdf = await page.evaluate(() => {
      const docs = (document.querySelector('.rd-view')?.renderer?.getContents?.() || []).map((c) => c.doc).filter(Boolean);
      const out = { page: document.querySelector('.rd-page')?.textContent, marks: 0, near: false, chip: document.querySelector('.rd-fts-chip:not(.hidden) .rd-fts-q')?.textContent };
      for (const d of docs) {
        const rects = [...d.querySelectorAll('.rd-fts-mark rect')];
        if (!rects.length) continue;
        out.marks += rects.length;
        // the mark lies on the word: the text layer's "Läufer"
        const span = [...d.querySelectorAll('.textLayer span')].find((s) => /Läufer/.test(s.textContent));
        if (span) {
          const r = d.createRange(); const t = span.firstChild; const i = t.data.indexOf('Läufer');
          r.setStart(t, i); r.setEnd(t, i + 6);
          const a = r.getBoundingClientRect(), b = rects[0].getBoundingClientRect();
          out.near = Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 6 && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 6;
        }
      }
      return out;
    });
    check('reader-pdf-hit', /Seite 3 von 12/.test(pdf.page || '') && pdf.marks >= 1 && pdf.near && /Läufer/.test(pdf.chip || ''), `focus was on ${focused}, ${JSON.stringify(pdf)}`);
    await showChrome();
    await shot('search-reader-pdf');
    await page.keyboard.press('Escape');
    await sleep(900);
    const backView = await page.evaluate(() => ({ panels: [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel), q: document.querySelector('.fts-input')?.value, hits: document.querySelectorAll('.fts-hit').length }));
    check('back-to-results', backView.panels.join() === 'search' && backView.q === 'Läufer' && backView.hits === 3, JSON.stringify(backView));
  }

  if (parts.has('reader')) {
    // an EPUB with print pages: page 18, chapter 4, the word on the page and marked
    await k.closeAll();
    await k.open('search', { q: 'Leuchtturm' }, 1500);
    await page.evaluate(() => document.querySelector('.fts-hit')?.click());
    await page.waitForFunction(() => /Seite 18/.test(document.querySelector('.rd-page')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    await sleep(1800);
    const epub = await page.evaluate(() => {
      const v = document.querySelector('.rd-view');
      const c = v?.renderer?.getContents?.() || [];
      return { page: document.querySelector('.rd-page')?.textContent, chapter: document.querySelector('.rd-chapter')?.textContent, visible: /Leuchtturm/.test(v?.lastLocation?.range?.toString() || ''), marks: c.reduce((a, x) => a + (x.overlayer?.element?.querySelectorAll('.rd-fts-mark').length || 0), 0) };
    });
    check('reader-epub-hit', epub.page === 'Seite 18' && epub.chapter === 'Kapitel 4' && epub.visible && epub.marks >= 1, JSON.stringify(epub));
    await showChrome();
    await shot('search-reader-epub');
    // a text file: the section and its offset lead to the word
    await k.closeAll();
    await k.open('search', { q: 'Zitronenfalter' }, 1500);
    await page.evaluate(() => document.querySelector('.fts-hit')?.click());
    await sleep(4500);
    const txt = await page.evaluate(() => { const v = document.querySelector('.rd-view'); const c = v?.renderer?.getContents?.() || []; return { visible: /Zitronenfalter/.test(v?.lastLocation?.range?.toString() || ''), marks: c.reduce((a, x) => a + (x.overlayer?.element?.querySelectorAll('.rd-fts-mark').length || 0), 0) }; });
    check('reader-txt-hit', txt.visible && txt.marks >= 1, JSON.stringify(txt));
    // the ✕ of the chip removes the marks
    await showChrome();
    await page.evaluate(() => document.querySelector('.rd-fts-clear')?.click());
    await sleep(400);
    const cleared = await page.evaluate(() => { const c = document.querySelector('.rd-view')?.renderer?.getContents?.() || []; return { marks: c.reduce((a, x) => a + (x.overlayer?.element?.querySelectorAll('.rd-fts-mark').length || 0), 0), chip: !document.querySelector('.rd-fts-chip')?.classList.contains('hidden') }; });
    check('reader-clear-marks', cleared.marks === 0 && !cleared.chip, JSON.stringify(cleared));
  }

  if (parts.has('keys')) {
    // Strg+F in the reader: the panel opens over it with the words; a hit in the same book moves this reader
    await k.closeAll();
    const laeufer = idOf('laeufer');
    await k.open('reader', { id: laeufer }, 3000);
    await page.evaluate(() => document.querySelector('.rd-root')?.focus());
    await page.keyboard.press('Control+f');
    await sleep(900);
    const over = await panels();
    await page.keyboard.type('Caro-Kann', { delay: 20 });
    await page.waitForFunction(() => document.querySelectorAll('.fts-hit').length >= 1, null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => document.querySelector('.fts-hit')?.click());
    await page.waitForFunction(() => /Seite 12 von/.test(document.querySelector('.rd-page')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const moved = { panels: await panels(), page: await page.evaluate(() => document.querySelector('.rd-page')?.textContent) };
    check('ctrl-f-in-reader', over.join() === 'reader,search' && moved.panels.join() === 'reader' && /Seite 12 von 12/.test(moved.page || ''), `over ${over} → ${JSON.stringify(moved)}`);
    await k.closeAll();
    // Strg+F in the world, the button in the menu
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Control+f');
    await sleep(800);
    const world = await panels();
    await k.closeAll();
    await k.open('menu', {}, 900);
    const menuBtn = await page.evaluate(() => { const b = [...document.querySelectorAll('.menu-btn')].find((x) => x.textContent === 'Volltextsuche'); b?.click(); return !!b; });
    await sleep(900);
    check('keys-world-and-menu', world.includes('search') && menuBtn && (await panels()).includes('search'), `Strg+F → ${world}, menu button ${menuBtn}`);
    await k.closeAll();
  }

  if (parts.has('peek')) {
    // a hit only looked at keeps the reading position; turning a page from there moves it
    const id = idOf('bishop');
    const rec0 = await page.evaluate((x) => window.api.library.book(x), id);
    await k.open('search', { q: 'stories' }, 1400);
    await page.evaluate(() => document.querySelector('.fts-hit')?.click());
    await page.waitForFunction(() => /Seite 6 von/.test(document.querySelector('.rd-page')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await page.keyboard.press('Escape'); await sleep(1200);
    const rec1 = await page.evaluate((x) => window.api.library.book(x), id);
    check('peek-keeps-position', rec1.lastLocation === rec0.lastLocation && (rec1.progress || 0) === (rec0.progress || 0), `before ${rec0.lastLocation}/${rec0.progress} after ${rec1.lastLocation}/${rec1.progress}`);
    await page.evaluate(() => document.querySelector('.fts-hit')?.click());
    await page.waitForFunction(() => /Seite 6 von/.test(document.querySelector('.rd-page')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    await page.evaluate(() => document.querySelector('.rd-root')?.focus());
    await page.keyboard.press('ArrowRight'); await sleep(1500);
    const turned = await page.evaluate(() => document.querySelector('.rd-page')?.textContent);
    await page.keyboard.press('Escape'); await sleep(1500);
    const rec2 = await page.evaluate((x) => window.api.library.book(x), id);
    check('turned-page-saves', !!rec2.lastLocation && rec2.lastLocation !== rec0.lastLocation && (rec2.progress || 0) > 0.5, `${turned}: ${rec2.lastLocation} ${rec2.progress}`);
    await k.closeAll();
  }

  if (parts.has('changes')) {
    // the TXT changes, the RTF goes, the DOCX moves to another folder
    const txt = path.join(lib, truth.books.txt);
    fs.writeFileSync(txt, fs.readFileSync(txt, 'utf8').replace('Zitronenfalter', 'Schwalbenschwanz'), 'utf8');
    fs.rmSync(path.join(lib, truth.books.rtf));
    const docxFrom = path.join(lib, truth.books.docx), docxTo = path.join(lib, 'Romane', path.basename(truth.books.docx));
    const before = await status(true);
    const docxRow = before.books.find((b) => b.id === idOf('docx'));
    fs.renameSync(docxFrom, docxTo);
    const ok = await waitFor(async () => {
      const a = await search('Schwalbenschwanz'), b = await search('Zitronenfalter'), c = await search('Marzipantorte'), d = await search('Wetterstation');
      return a.books.length === 1 && !b.books.length && !c.books.length && d.books.length === 1 ? { a, d } : null;
    }, 90000, 1500);
    await refreshBooks();
    const after = await status(true);
    const moved = after.books.find((b) => b.id === ok?.d?.books?.[0]?.id);
    check('changed-book-read-again', !!ok, ok ? 'new word found, old one gone, the deleted book gone' : 'timeout');
    check('moved-book-kept', !!moved && moved.id !== docxRow?.id && moved.at === docxRow?.at, `${docxRow?.id} → ${moved?.id}, read at ${moved?.at} (before ${docxRow?.at})`);
  }

  // a new long book: read in the background, paused while the reader is open; then the app closes while it is read
  let longId = null;
  if (parts.has('pause')) {
    const dst = path.join(lib, truth.books.long);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // copied beside the library ("$…" folders are no part of it), then moved in at once: the watcher sees a whole file
    const tmp = path.join(lib, path.dirname(truth.extra.long), 'copy.pdf');
    fs.copyFileSync(path.join(lib, truth.extra.long), tmp);
    fs.renameSync(tmp, dst);
    const running = await waitFor(async () => { const s = await status(); return s.current && /lange Buch/.test(s.current.title || '') && s.current.unit > 20 ? s : null; }, 90000, 300);
    longId = running?.current?.id;
    const a = await status(), ta = Date.now();
    await sleep(4000);
    const b = await status(), tb = Date.now();
    const speed = (b.current?.unit - a.current?.unit) / ((tb - ta) / 1000);
    const mem = await memory();
    check('new-book-indexing', !!running && speed > 0 && mem.reader > 0, `${Math.round(speed)} pages/s while reading "Das lange Buch" (9600 pages); memory: main ${mem.main} MB, reading window ${mem.reader} MB, indexer window ${mem.indexer} MB`);
    // the reader opens: the index stops after the current page and waits
    await k.open('reader', { id: idOf('laeufer') }, 2500);
    const p1 = await status();
    await sleep(3000);
    const p2 = await status();
    check('paused-while-reading', p1.paused === 'reading' && p2.paused === 'reading' && p2.current?.unit === p1.current?.unit && !p2.running, `paused ${p2.paused} at page ${p1.current?.unit} → ${p2.current?.unit}`);
    await k.closeAll();
    const resumed = await waitFor(async () => { const s = await status(); return s.current && s.current.unit > p2.current.unit + 10 ? s : null; }, 30000, 300);
    check('resumes-after-reading', !!resumed, `page ${p2.current?.unit} → ${resumed?.current?.unit}`);
    // from here on the reader stays open underneath: the long book waits, and the app closes while it is half read
    await k.open('reader', { id: idOf('laeufer') }, 1500);
  }

  if (parts.has('settings')) {
    // over the reader that holds the long book (k.open stacks the panel on top)
    await k.open('settings', { section: 'library' }, 1200);
    await page.evaluate(() => document.querySelector('.fts-set-status')?.scrollIntoView({ block: 'center' }));
    await sleep(600);
    const set = await page.evaluate(() => ({ status: document.querySelector('.fts-set-status')?.innerText.replace(/\s+/g, ' '), rebuild: [...document.querySelectorAll('.fts-set-actions button')].map((b) => b.textContent), toggle: [...document.querySelectorAll('.setting label')].some((l) => /^Volltextsuche/.test(l.textContent)) }));
    check('settings-rows', set.toggle && /Büchern durchsucht/.test(set.status || '') && /Index/.test(set.status || '') && set.rebuild.includes('Index neu aufbauen'), JSON.stringify(set));
    await shot('search-settings');
    // the language switch changes the texts at once
    await page.evaluate(() => window.api.settings.set({ language: 'en' }));
    await sleep(700);
    const en = await page.evaluate(() => ({ status: document.querySelector('.fts-set-status')?.innerText.replace(/\s+/g, ' '), title: [...document.querySelectorAll('.settings-group')].map((x) => x.textContent).find((x) => /Full-text/.test(x)) }));
    await page.evaluate(() => window.api.settings.set({ language: 'de' }));
    await sleep(500);
    check('settings-english', /books searched/.test(en.status || '') && !!en.title, JSON.stringify(en));
    await page.evaluate(() => document.querySelector('.panel-layer[data-panel="settings"] .panel-header .btn.icon')?.click());
    await sleep(500);
  }

  // the app closes while the long book is read (the reader holds it): note how far it got (SEARCH_PHASE=restart)
  if (longId) {
    const st = await status(true);
    const row = st.books.find((b) => b.id === longId);
    fs.writeFileSync(stateFile, JSON.stringify({ longId, longNext: row?.next || 0, doneRows: st.books.filter((b) => b.state === 'done' || b.state === 'notext').length }));
    log(`long book stopped at page ${row?.next} of 9600 (${row?.state})`);
  }
  const errs = k.errors.filter((e) => !/allow-scripts and allow-same-origin/.test(e));
  check('no-renderer-errors', errs.length === 0, JSON.stringify(errs.slice(0, 4)));
  log(`SEARCH-CHECK ${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} passed (phase 1)`);
};
