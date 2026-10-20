// "Alle Cover jetzt laden" over a large library, without any network: the catalogues and Bing's image search answer
// from made-up answers in their own formats (electron/library/cover-synth.js: Open Library knows six of seven titles
// and has a picture of each, Bing shows the picture of three in four titles on two shops; Yandex and DuckDuckGo stay
// unreachable). Every book of the test library is set back to "page 1 is no cover" first (like a library whose PDFs
// start with a title page), then the run starts as the button in the settings starts it. Checked: six books at a
// time, the books the catalogues do not know going to the image search in the same run, the progress, pause and
// continue, cancel, a new run, the app quitting in the middle and going on after the restart where it stopped, each
// cover stored at once and shown in the room without a rebuild, the memory of the main process (bounded, no pictures
// kept), the time per book, DuckDuckGo's budget, and the frames in the book room while it runs (no frame over 50 ms
// caused by the run: the same walk with the run paused and going, by turns, since the graphics card is shared).
//   two starts with the same COZYSHELVES_USERDATA (and a copy of the large test library, books2\lib-master; a data folder of
//   an earlier run may be used again, it saves the indexing):
//   COZYSHELVES_BOOKS="<copy>|structured" COZYSHELVES_USERDATA=<folder> SHOT_DIR=<folder> COZYSHELVES_COVERS_FIXTURES=<empty folder>
//     COZYSHELVES_COVERS_SYNTH=1 COZYSHELVES_COVERS_SYNTH_DELAY=250 COZYSHELVES_COVERS_GAP=60000 node build/screenshot.js covers-batch-check
//   … the same with BATCH_PHASE=restart
//   BATCH_PHASE=speed with COZYSHELVES_COVERS_PACE=1 and COZYSHELVES_COVERS_SYNTH_DELAY=300: a whole run with the real pauses and
//   budgets of every host and answers that take their time, books a minute and the work of each catalogue
// (COZYSHELVES_COVERS_GAP: the search in the background takes one book a minute, so the run finds the books untouched;
// COZYSHELVES_COVERS_SYNTH_DELAY: each made-up answer takes a quarter of a second, so the run lasts a few minutes.)
const path = require('path');
const WEB_COVERS = path.join(__dirname, '..', '..', 'electron', 'library', 'web-covers.js');
const PHASE = process.env.BATCH_PHASE || 'run';

module.exports = async ({ app, page, sleep, shot }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 100 && st.idx === st.n && !st.active) break;
    await sleep(2000);
  }
  await sleep(2500);
  const status = () => page.evaluate(() => window.__app.ctx.api.invoke('covers:status'));
  const main = (fn, arg) => app.evaluate(fn, [WEB_COVERS, arg]);
  const memory = () => app.evaluate(() => { const m = process.memoryUsage(); return { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) }; });

  // frames in the book room: rAF intervals, long tasks of the renderer, the covers put on the graphics card
  await page.evaluate(() => {
    const w = window.__app.world;
    const P = window.__perf = { frames: [], long: [], on: true, books: 0, updates: 0 };
    let last = 0;
    const tick = (t) => { if (last) P.frames.push(t - last); last = t; if (P.on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
    window.__app.ctx.api.library.onBook(() => { P.books++; });
    window.__app.ctx.api.library.onUpdate(() => { P.updates++; });
    w.player.transition = null; w.player.setPose(0, -12, 0, 0);
  });
  const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +q(1).toFixed(1), over50: s.filter((x) => x > 50).length }; };
  /** Walk through the book room for `ms` (turning slowly), the frames and long tasks of that time. */
  const walk = async (ms, until = null) => {
    // the shelves built, the library's full updates and the books updated meanwhile (what else the page had to do)
    const start = await page.evaluate(() => [window.__app.world.buildTimes.length, window.__perf.updates, window.__perf.books]);
    await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.long.length = 0; document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); });
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await page.evaluate(() => { const p = window.__app.world.player; p.yaw += 0.025; if (Math.hypot(p.position.x, p.position.z + 12) > 4) p.setPose(0, -12, p.yaw, 0); });
      if (until && (await until())) break;
      await sleep(50);
    }
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
    return page.evaluate(([b0, u0, k0]) => ({ frames: window.__perf.frames.slice(), long: window.__perf.long.slice(), builds: window.__app.world.buildTimes.length - b0, updates: window.__perf.updates - u0, books: window.__perf.books - k0 }), start);
  };
  /**
   * The walk with the run paused and going, by turns (`rounds` × `ms` each): the graphics card is shared with other
   * programs, so both get the same minutes. `watch` follows the run while it goes.
   */
  const abWalk = async (rounds, ms, watch = null) => {
    const sum = () => ({ frames: [], long: [], ms: 0, builds: 0, updates: 0, books: 0 });
    const off = sum(), on = sum();
    const add = (acc, w, t) => { acc.frames.push(...w.frames); acc.long.push(...w.long); acc.ms += t; acc.builds += w.builds; acc.updates += w.updates; acc.books += w.books; };
    // both walks ask the same questions meanwhile (the asking costs the page a little as well)
    const follow = async () => { if (watch) await watch(); else await status(); return false; };
    for (let i = 0; i < rounds; i++) {
      await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'pause'));
      for (let k = 0; k < 50 && (await status()).batch.current.length; k++) await sleep(100);     // the books in hand first
      let t = Date.now();
      add(off, await walk(ms, follow), Date.now() - t);
      await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'resume'));
      t = Date.now();
      add(on, await walk(ms, follow), Date.now() - t);
    }
    return { off, on };
  };
  const frameCheck = (label, off, on) => {
    const b = stats(off.frames), d = stats(on.frames);
    const perMin = (x) => Math.round((x.long.filter((v) => v > 50).length / Math.max(1, x.ms)) * 60e3 * 10) / 10;
    console.log(`FRAMES ${label} paused ${JSON.stringify(b)} long tasks/min ${perMin(off)} · going ${JSON.stringify(d)} long tasks/min ${perMin(on)} ${JSON.stringify(on.long.slice(0, 20))} · shelves built ${on.builds}, library updates ${on.updates}, books updated ${on.books}`);
    // frames over 50 ms and long tasks of the page count against the run only beyond those of the same walk without it;
    // 95 % of the frames within half again of the paused walk's, or within a frame of a 60 Hz display (on a fast
    // display one more vsync now and then already doubles the 95th percentile)
    const extra = d.over50 / Math.max(1, d.n) - b.over50 / Math.max(1, b.n);
    check(`${label}: no frame over 50 ms caused by the run (the same walk with the run paused and going, by turns)`, extra <= 0.005 && d.p95 <= Math.max(b.p95 * 1.5, b.p95 + 6, 1000 / 60) && perMin(on) <= perMin(off) * 1.5 + 3 && on.builds === 0 && on.books > 0,
      { paused: { over50: b.over50, n: b.n, p95: b.p95, longPerMin: perMin(off) }, going: { over50: d.over50, n: d.n, p95: d.p95, longPerMin: perMin(on), books: on.books } });
  };

  /** How the covers of the books came: { openlibrary: n, bing: n, … } */
  const vias = () => main((_, [file]) => { const wc = process.mainModule.require(file).instance; const v = {}; for (const b of Object.values(wc.library.books)) if (b.coverSource === 'web') v[b.coverWeb?.via || '?'] = (v[b.coverWeb?.via || '?'] || 0) + 1; return v; });
  /** The searches of the image search engines so far, and the rests of the hosts (Google's "no quota" aside). */
  const engineState = () => main((_, [file]) => { const wc = process.mainModule.require(file).instance; return { searches: { ...wc.stats.engines }, ddgSearches: wc.stats.searches, ddgRecent: (wc.state.ddg.recent || []).length, rests: Object.keys(wc.state.rests).filter((k) => k !== 'www.googleapis.com' && wc.state.rests[k].until > Date.now()) }; });

  /** Every book of the library without a cover of its own (page 1 a title page), nothing asked yet (a data folder of an earlier run gets its covers from the internet taken back first). */
  const markAll = () => main((_, [file]) => {
      const wc = process.mainModule.require(file).instance;
      const M = process.mainModule.require(file.replace('web-covers.js', 'cover-match.js'));
      let n = 0;
      for (const b of Object.values(wc.library.books)) {
        if (b.coverSource === 'web') wc.library.restoreBookCover(b.id, { choice: null });
        // the metadata an earlier run filled in go too (a fresh library knows none of them)
        if (b.metaWeb) { for (const [k, v] of Object.entries(b.metaWeb.val || {})) if (b[k] === v) delete b[k]; if (b.metaWeb.was) Object.assign(b, b.metaWeb.was); delete b.metaWeb; }
        if (!wc.lookable(b) || b.coverSource === 'web') continue;
        b.coverWeak = 'text'; b.coverCheck = M.COVER_CHECK; delete b.coverChoice; n++;
        wc.library.notifyBook(b.id);
      }
      wc.state.fast = {}; wc.state.misses = {}; wc.state.batch = null;
      wc.library.db.save(); wc.store.save();
      return { n, network: wc.network, gap: wc.gap };
    });
  /** The requests each host got so far. */
  const hostCounts = () => main((_, [file]) => { const wc = process.mainModule.require(file).instance; const o = {}; for (const [k, h] of wc.net.hosts) if (h.count) o[k] = h.count; return o; });

  if (PHASE === 'speed') {
    // ---- the real budgets of every host: how many books a minute -------------------------------------------------
    const marked = await markAll();
    check('the large library: every book is set back to "page 1 is no cover"', marked.n > 400, marked);
    await sleep(3000);
    const t0 = Date.now();
    let st = await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'start'));
    let most = 0;
    for (let i = 0; i < 3600 && (st = await status()).batch.state === 'running'; i++) { most = Math.max(most, st.batch.current.length); await sleep(500); }
    const secs = Math.round((Date.now() - t0) / 1000);
    const via = await vias(), eng = await engineState(), hosts = await hostCounts();
    const perMinute = Math.round((st.batch.total / Math.max(1, secs)) * 60 * 10) / 10;
    const perSource = Object.fromEntries(Object.entries(via).map(([k, n]) => [k, Math.round((n / Math.max(1, secs)) * 60 * 10) / 10]));
    console.log('SPEED ' + JSON.stringify({ books: st.batch.total, seconds: secs, perMinute, found: st.batch.found, missed: st.batch.missed, failed: st.batch.failed, mostAtOnce: most, via, perSource, hosts, engines: eng, for850Minutes: Math.round((850 / perMinute) * 10) / 10 }));
    check('a whole run with the real pauses and budgets of every host: 850 books in well under a quarter of an hour', st.batch.state === 'done' && perMinute >= 80, { perMinute, seconds: secs, books: st.batch.total });
    check('the books spread over the catalogues (each covers its share)', Object.keys(via).filter((k) => !['bing', 'yandex', 'duckduckgo'].includes(k)).length >= 4, via);
    check('no host rests: every one within its budget', eng.rests.length === 0, eng);
  } else if (PHASE === 'run') {
    // every book of the library without a cover of its own (page 1 a title page), nothing asked yet (a data folder of
    // an earlier run gets its covers from the internet taken back first)
    const marked = await main((_, [file]) => {
      const wc = process.mainModule.require(file).instance;
      const M = process.mainModule.require(file.replace('web-covers.js', 'cover-match.js'));
      let n = 0;
      for (const b of Object.values(wc.library.books)) {
        if (b.coverSource === 'web') wc.library.restoreBookCover(b.id, { choice: null });
        if (!wc.lookable(b) || b.coverSource === 'web') continue;
        b.coverWeak = 'text'; b.coverCheck = M.COVER_CHECK; delete b.coverChoice; n++;
        wc.library.notifyBook(b.id);
      }
      wc.state.fast = {}; wc.state.misses = {}; wc.state.batch = null;
      wc.library.db.save(); wc.store.save();
      return { n, network: wc.network, gap: wc.gap };
    });
    check('the large library: every book is set back to "page 1 is no cover"', marked.n > 400, marked);
    const mem0 = await memory();
    // "Alle Cover jetzt laden", as the button sends it
    const t0 = Date.now();
    let st = await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'start'));
    check('the run starts over all books without a cover', st.batch.state === 'running' && st.batch.total >= marked.n - 5, { total: st.batch.total, marked: marked.n });
    let most = 0, heap = [mem0.heap], rss = [mem0.rss];
    const watch = async () => { const s = await status(); most = Math.max(most, s.batch.current.length); const m = await memory(); heap.push(m.heap); rss.push(m.rss); return s; };
    // the frames while the first books come in
    const ab = await abWalk(3, 8000, watch);
    frameCheck('first run', ab.off, ab.on);
    for (let i = 0; i < 200 && (st = await watch()).batch.done < 60; i++) await sleep(250);
    // pause: the books in hand are finished, then nothing happens
    await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'pause'));
    for (let i = 0; i < 40 && (st = await watch()).batch.current.length; i++) await sleep(250);
    const pausedAt = st.batch.done;
    await sleep(3000);
    st = await watch();
    check('pause: the books in hand are finished, then nothing more happens', st.batch.state === 'paused' && st.batch.done === pausedAt && !st.batch.current.length, { state: st.batch.state, done: st.batch.done, pausedAt });
    // the panel shows the progress and "Fortsetzen"
    await page.evaluate(() => window.__app.openPanel('settings', { section: 'library' }));
    await page.waitForSelector('.cv-batch .progress-bar', { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const ui = await page.evaluate(() => ({ text: document.querySelector('.cv-batch')?.textContent || '', buttons: [...document.querySelectorAll('.cv-batch button')].map((b) => b.textContent), bar: document.querySelector('.cv-batch .progress-bar')?.getAttribute('aria-valuenow') }));
    check('the settings show n of m, found and not found, "Fortsetzen" and "Abbrechen"', /\d+ von \d+/.test(ui.text) && /gefunden/.test(ui.text) && ui.buttons.includes('Fortsetzen') && ui.buttons.includes('Abbrechen') && +ui.bar === pausedAt, ui);
    await shot('batch-paused');
    // continue from the panel's button
    await page.evaluate(() => [...document.querySelectorAll('.cv-batch button')].find((b) => b.textContent === 'Fortsetzen').click());
    for (let i = 0; i < 200 && (st = await watch()).batch.done < pausedAt + 40; i++) await sleep(250);
    const ui2 = await page.evaluate(() => ({ text: document.querySelector('.cv-batch')?.textContent || '', buttons: [...document.querySelectorAll('.cv-batch button')].map((b) => b.textContent) }));
    check('"Fortsetzen" goes on, the panel follows with "Gerade: …" and "Pause"', st.batch.state === 'running' && st.batch.done >= pausedAt + 40 && ui2.buttons.includes('Pause') && /Gerade: |…|Wartet/.test(ui2.text), { done: st.batch.done, ui: ui2 });
    await shot('batch-running');
    await page.evaluate(() => window.__app.closeAllPanels());
    // cancel: stops, keeps what was found
    await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'cancel'));
    for (let i = 0; i < 40 && (st = await watch()).batch.current.length; i++) await sleep(250);
    const webAfterCancel = st.web;
    await sleep(2000);
    st = await watch();
    check('cancel: the run stops, the covers found stay', st.batch.state === 'cancelled' && st.web === webAfterCancel && st.web > 50 && st.pending > 100, { state: st.batch.state, web: st.web, pending: st.pending, done: st.batch.done, total: st.batch.total });
    // a new run takes the rest; the app quits in the middle of it
    st = await page.evaluate(() => window.__app.ctx.api.invoke('covers:batch', 'start'));
    check('a new run takes only the books not asked yet', st.batch.state === 'running' && st.batch.total === st.pending, { total: st.batch.total, pending: st.pending });
    for (let i = 0; i < 200 && (st = await watch()).batch.done < 50; i++) await sleep(250);
    const s1 = await status();
    const perBook = s1.batch.perBook;
    const secs1 = Math.round((Date.now() - t0) / 1000);
    const via1 = await vias(), eng1 = await engineState();
    console.log('RUN1 ' + JSON.stringify({ seconds: secs1, done: s1.batch.done, of: s1.batch.total, web: s1.web, perBookMs: perBook, perMinute: s1.batch.perMinute, mostAtOnce: most, heapMB: { start: mem0.heap, max: Math.max(...heap) }, rssMB: { start: mem0.rss, max: Math.max(...rss) }, peak: s1.batch.peak, via: via1, engines: eng1, ddgRequests: s1.stats.ddgRequests }));
    check('six books at a time at most', most >= 4 && most <= 6, { most });
    // how many of these books reach Bing depends on the timing: Bing takes one search every 4 s, a book in that gap goes
    // to Yandex or DuckDuckGo, which cannot be reached here (0.7.0: 7 searches, 5 covers; 0.7.1: 5 searches, 3 covers)
    check('the books the catalogues do not know get their covers from the image search in the same run (Bing\'s cache)', (eng1.searches.bing || 0) >= 2 && (via1.bing || 0) >= 1 && (via1.openlibrary || 0) > (via1.bing || 0), { via: via1, searches: eng1.searches });
    check('every engine within its budget, none rests: DuckDuckGo at most one search every three minutes', eng1.rests.length === 0 && eng1.ddgSearches <= 2 + Math.floor(secs1 / 180) && eng1.ddgRecent <= 4, eng1);
    await main((_, [file]) => { process.mainModule.require(file).instance.store.flush(); return true; });
    console.log('QUIT while running: ' + JSON.stringify({ done: s1.batch.done, total: s1.batch.total }));
  } else {
    // ---- after the restart: the run goes on by itself where it stopped ---------------------------------------------
    // (COZYSHELVES_COVERS_SYNTH_DELAY slows the made-up answers down, so that the run outlasts the start of the app; the
    // shelves are built again 9 s after the scan, the frames are measured after that)
    await sleep(12000);
    let st = await status();
    const at = st.batch;
    check('after the restart the run goes on by itself', at.state === 'running' && at.done > 0 && at.done < at.total, { state: at.state, done: at.done, total: at.total });
    const mem0 = await memory();
    const heap = [mem0.heap], rss = [mem0.rss];
    const t0 = Date.now();
    const watch = async () => { const s = await status(); const m = await memory(); heap.push(m.heap); rss.push(m.rss); st = s; return s; };
    const ab = await abWalk(3, 8000, watch);
    for (let i = 0; i < 1200 && (await watch()).batch.state === 'running'; i++) await sleep(500);
    const secs = Math.round((Date.now() - t0) / 1000);
    check('the run finishes: every book asked once, found and not found counted', st.batch.state === 'done' && st.batch.done === st.batch.total && st.batch.found + st.batch.missed + st.batch.failed + st.batch.skipped === st.batch.total, st.batch);
    const via2 = await vias(), eng2 = await engineState();
    check('nothing is left: the catalogues and the image search asked about every book', st.pending === 0 && st.waiting <= 3 && st.web > 400 && (via2.bing || 0) >= 5, { pending: st.pending, web: st.web, waiting: st.waiting, missed: st.missed, via: via2 });
    check('after the restart too every engine stays within its budget, none rests', eng2.rests.length === 0 && eng2.ddgSearches <= 2 + Math.floor(secs / 180) && eng2.ddgRecent <= 4, eng2);
    frameCheck('after the restart', ab.off, ab.on);
    const memEnd = await memory();
    const kept = await main((_, [file]) => { const wc = process.mainModule.require(file).instance; return { picks: wc.picks.size, ddg: wc.cache.size, inFlight: wc.inFlight.size, decoding: wc.decoding, queue: wc.decodeQueue.length }; });
    console.log('RUN2 ' + JSON.stringify({ seconds: secs, total: st.batch.total, found: st.batch.found, missed: st.batch.missed, failed: st.batch.failed, perBookMs: st.batch.perBook, perMinute: st.batch.perMinute, heapMB: { start: mem0.heap, max: Math.max(...heap), end: memEnd.heap }, rssMB: { start: mem0.rss, max: Math.max(...rss), end: memEnd.rss }, peak: st.batch.peak, kept, via: via2, engines: eng2 }));
    // (the results of the last eight image searches stay for "Anderes Cover", previews of 220 px: a few MB at most)
    check('the memory of the main process stays bounded: no picture is kept after it is stored', Math.max(...heap) - mem0.heap < 120 && kept.picks === 0 && kept.ddg <= 8 && kept.inFlight === 0 && kept.decoding === 0 && kept.queue === 0, { heap: { start: mem0.heap, max: Math.max(...heap) }, kept });
    check('a book gets its cover in well under a second of the run', st.batch.perBook > 0 && st.batch.perBook < 1500, { perBookMs: st.batch.perBook });
    // the room shows the new covers without a rebuild: a book on a shelf, pulled out, with its picture
    const builds = await page.evaluate(() => window.__app.world.buildTimes.length);
    const shown = await page.evaluate(() => {
      const w = window.__app.world, p = w.player;
      const books = window.__app.state.library.books.filter((b) => b.coverSource === 'web' && w.books.entry(b.id));
      const b = books[Math.floor(books.length / 2)];
      if (!b) return null;
      const e = w.books.entry(b.id);
      const x = e.pos.x + e.forward.x * 1.1, z = e.pos.z + e.forward.z * 1.1;
      p.transition = null;
      p.setPose(x, z, 0, 1.2); p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001);
      for (let i = 0; i < 30; i++) w.books.update(1 / 60, w.camera);
      p.setPose(x, z, Math.atan2(-(e.pos.x - x), -(e.pos.z - z)), Math.atan2(e.pos.y - 1.62, Math.hypot(e.pos.x - x, e.pos.z - z)));
      p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001);
      return { id: b.id, title: b.title, entry: e.book.coverSource };
    });
    await sleep(1500);
    const slot = shown && await page.evaluate((id) => { const s = window.__app.world.books.slots.find((x) => x.entry?.book.id === id && x.target > 0); return s ? { typo: s.typo, cover: !!s.front.map?.userData?.cover, book: s.entry.book.coverSource } : null; }, shown.id);
    const same = await page.evaluate((n) => window.__app.world.buildTimes.length === n, builds);
    check('the room shows the new covers (a book pulled out shows its picture) without a rebuild', shown && shown.entry === 'web' && slot && slot.cover && !slot.typo && same, { shown, slot, rebuilt: !same });
    await shot('batch-room-cover');
    await page.evaluate(() => window.__app.openPanel('settings', { section: 'library' }));
    await page.waitForSelector('.cv-batch', { timeout: 15000 }).catch(() => {});
    await sleep(1200);
    const ui = await page.evaluate(() => document.querySelector('.cv-batch')?.textContent || '');
    check('the settings say the run is done, with found and not found and the time it took', /Fertig: \d+ Cover gefunden, \d+ nicht gefunden, in /.test(ui), ui);
    await shot('batch-done');
    await page.evaluate(() => window.__app.closeAllPanels());
  }
  await page.evaluate(() => { window.__perf.on = false; });
  const failed = results.filter((r) => !r.ok);
  if (errors.length) console.log('page errors: ' + errors.slice(0, 5).join(' | '));
  console.log(`COVERS-BATCH-CHECK (${PHASE}) ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
