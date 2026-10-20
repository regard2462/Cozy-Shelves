// The shelves of 0.7 in the running app: the case "Gelesen" left of the passage with its sign and its place, without a
// card or a plaque (0.7.1: empty or full, German or English; the reading goal is counted in the library's statistics,
// shown on the computer); C on a book moves it there and back, reading to 97 % as well, newest first; the setting
// switches the case off and on; a book that exists twice stands once (the preferred copy: EPUB before PDF, the one being
// read), all copies with the setting off, and the books that only look alike always stand; every sort order puts the
// books of a shelf in the right order (read from the world's placement data) without a long frame and keeps the spine
// atlases (a new title draws them anew); the book info lists the other copies with "Im Explorer zeigen" (the Explorer
// itself is never opened: ctx.revealFile records the call); the list "Doppelte Bücher" from the settings; the language
// field holds two letters or nothing. No renderer errors.
// Library: python build/testlib/gen_shelves.py <folder>\lib, then COZYSHELVES_BOOKS="<folder>\lib|structured".
// SH_PARTS=case,mark,progress,toggle,dupes,sort,info,list,lang,shots (default: all); SHOT_TAG prefixes the screenshots.
const path = require('path');
const { sortIds, seriesOf } = require(path.join(__dirname, '..', '..', 'electron', 'library', 'shelf-order.js'));

module.exports = async ({ page, shot, sleep }) => {
  const tag = process.env.SHOT_TAG || 'sh';
  const parts = (process.env.SH_PARTS || 'case,mark,progress,toggle,dupes,sort,info,list,lang,shots').split(',');
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  const errors = [];
  let failures = 0, passes = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passes++; else failures++; };
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 180; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && st.idx === st.n && !st.active) break;
    await sleep(1000);
  }
  await sleep(2500);
  // never open the Explorer from a test: the buttons call ctx.revealFile when it is there
  await page.evaluate(() => { window.__revealed = []; window.__app.ctx.revealFile = (id) => window.__revealed.push(id); });
  // every note that appears (they fade after a few seconds)
  await page.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.querySelector('#toasts'), { childList: true }); });

  // ------------------------------------------------------------------ helpers (in the page) ----
  await page.evaluate(() => {
    const A = window.__app;
    window.__sh = {
      byTitle: (t, fmt) => A.state.library.books.filter((b) => b.title === t && (!fmt || b.format === fmt)),
      placed: () => { const out = {}; for (const bc of A.world.layout.bookcases) bc.rows.forEach((r) => r.items.forEach((it, k) => { out[it.id] = { case: bc.id, read: !!bc.read, recent: !!bc.recent, level: r.level, k }; })); return out; },
      readCase: () => A.world.layout.bookcases.find((b) => b.read) || null,
      // the books of a case top row first, left to right
      caseOrder: (bc) => [...bc.rows].sort((a, b) => b.level - a.level).flatMap((r) => r.items.map((it) => it.id)),
      // a department's shelf as it stands: its cases in run order, rows top-down, books left to right
      shelfOrder: (depName, shelfName) => {
        const w = A.world, L = w.layout, run = L.departmentRuns.find((r) => r.name === depName);
        const dep = L.departments.find((d) => d.name === depName);
        const shelf = dep?.shelves.find((s) => (s.neutral ? '' : s.name) === shelfName);
        if (!run || !shelf) return null;
        const ids = new Set(shelf.bookIds);
        const out = [];
        for (const cid of run.cases) { const bc = L.bookcases.find((c) => c.id === cid); for (const r of [...bc.rows].sort((a, b) => b.level - a.level)) for (const it of r.items) if (ids.has(it.id)) out.push(it.id); }
        return out;
      },
      // aim at a book standing in a case: in front of it, the crosshair on its spine
      aim: (id) => {
        const w = A.world, e = w.books.entry(id); if (!e) return false;
        if (w.actions.seatedId) w.actions.leaveSeat();
        const p = e.pos.clone().addScaledVector(e.forward, 0.9);
        w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
        const dir = e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004).sub(w.camera.position).normalize();
        w.player.yaw = Math.atan2(-dir.x, -dir.z); w.player.pitch = Math.asin(dir.y);
        w.frame(); w.actions.rayTimer = 0; w.actions.update(0);
        return w.actions.target?.book?.id === id;
      },
      // what stands on the case "Gelesen" besides its books: a card (the 0.34 × 0.2 m card of an empty case, or its
      // texts among the signs) or the plaque of 0.7 on its board; the text of its sign above it
      extras: () => {
        const w = A.world, rd = w.layout.bookcases.find((b) => b.read);
        if (!rd) return null;
        let cards = 0;
        w.shelfGroup?.updateMatrixWorld(true);
        w.shelfGroup?.traverse((o) => {
          if (!o.isMesh) return;
          const p = o.geometry?.parameters, wp = o.getWorldPosition(o.position.clone());
          if (Math.hypot(wp.x - rd.x, wp.z - rd.z) > 1.0) return;
          if (p && Math.abs((p.width || 0) - 0.34) < 1e-3 && Math.abs((p.height || 0) - 0.2) < 1e-3) cards++;
        });
        const cardTexts = w.signs.entries('card').map((e) => e.key).filter((k) => /ausgelesen|have finished/i.test(k));
        const plaque = !!w.scene.getObjectByName('read-plaque') || !!w.scene.getObjectByName('read-plaque-face') || 'readPlaque' in w || 'readingPlaque' in w || typeof w.setReadingPlaque === 'function';
        const signs = (w.layout.signs || []).filter((s) => s.kind === 'read').map((s) => s.text[A.state.settings?.language === 'en' ? 'en' : 'de']);
        return { cards, cardTexts, plaque, signs, books: rd.rows.reduce((a, r) => a + r.items.length, 0), display: rd.display.length };
      },
    };
  });
  const settle = async (ms = 1600) => { await sleep(ms); for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(30); } };
  // waits until a condition in the page holds (the world rearranges a moment after the library reports a change)
  const until = async (pred, arg, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(pred, arg)) return true; await sleep(200); } return false; };
  // a setting of the shelves: until the app has it and the world shows what it calls for (ui/shelves.js arrange)
  const setShelves = async (patch) => {
    await page.evaluate((p) => window.__app.ctx.api.settings.set({ shelves: p }), patch);
    await until((p) => Object.entries(p).every(([k, v]) => window.__app.state.settings?.shelves?.[k] === v), patch);
    await until(() => window.__app.world.layout.arrangeKey === window.__app.shelves.arrange().key);
    await settle(600);
  };
  // the reading goal of the year as the library counts it (the computer's statistics show it)
  const goal = () => page.evaluate(async () => (await window.__app.ctx.api.library.stats())?.goal || null);
  // the language: until the app has it and the signs of the shelves are drawn in it (main.js i18n:change → world.relabel)
  const setLanguage = async (lang) => {
    await page.evaluate((l) => window.__app.ctx.api.settings.set({ language: l }), lang);
    await until((l) => window.__app.state.settings?.language === l, lang);
    await settle(900);
  };

  // ------------------------------------------------------------------ the case "Gelesen" ----
  if (parts.includes('case')) {
    await setShelves({ readingGoal: 12 });
    const c = await page.evaluate(() => {
      const w = window.__app.world, L = w.layout, rd = window.__sh.readCase(), rc = L.bookcases.find((b) => b.recent);
      return {
        at: rd && [+rd.x.toFixed(2), +rd.z.toFixed(2)], recentAt: rc && [+rc.x.toFixed(2), +rc.z.toFixed(2)], wood: rd?.wood,
        sign: (L.signs || []).filter((s) => s.kind === 'read').map((s) => [s.text.de, s.text.en, +s.x.toFixed(2)]),
        place: w.places.find((p) => p.id === 'finished') || null, readWall: L.directory?.readWall,
        empty: rd ? rd.rows.every((r) => !r.items.length) : null,
        otherOnSlot: L.bookcases.filter((b) => !b.read && Math.abs(b.x - rd.x) < 0.3 && Math.abs(b.z - rd.z) < 0.3).length,
      };
    });
    log('CASE', c);
    check('the case "Gelesen" stands left of the passage, opposite "Zuletzt gelesen", in walnut', !!c.at && Math.abs(c.at[0] + c.recentAt[0]) < 0.01 && c.at[1] === c.recentAt[1] && c.at[0] < 0 && c.wood === 'walnut' && c.otherOnSlot === 0, c);
    check('its sign says "Gelesen" / "Read", the places (G) and the directory know it', c.sign.length === 1 && c.sign[0][0] === 'Gelesen' && c.sign[0][1] === 'Read' && !!c.place && c.readWall === 'front', { sign: c.sign, place: c.place, readWall: c.readWall });
    // the empty case: its sign and bare shelves, no card, no plaque; in English as well
    const de = await page.evaluate(() => window.__sh.extras());
    await setLanguage('en');
    const en = await page.evaluate(() => window.__sh.extras());
    await setLanguage('de');
    log('EMPTY', { de, en });
    check('the empty case "Gelesen": no card in it and no plaque on its board, only its sign "Gelesen"', c.empty && de.books === 0 && de.cards === 0 && !de.cardTexts.length && !de.plaque && de.signs.join() === 'Gelesen', de);
    check('… in English as well: no card, no plaque, the sign "Read"', en.books === 0 && en.cards === 0 && !en.cardTexts.length && !en.plaque && en.signs.join() === 'Read', en);
    const g = await goal();
    check('the library counts the reading goal (the statistics on the computer show it): 0 of 12', g?.target === 12 && g.count === 0, g);
  }

  // ------------------------------------------------------------------ H marks a book as read and back ----
  let marked = null;
  if (parts.includes('mark')) {
    const pick = await page.evaluate(() => {
      const w = window.__app.world, L = w.layout;
      const run = L.departmentRuns.find((r) => r.name === 'Romane');
      const bc = L.bookcases.find((b) => b.id === run.cases[0]);
      const it = [...bc.rows].sort((a, b) => b.level - a.level)[0].items[1];
      return { id: it.id, title: w.booksById[it.id].title, from: bc.id };
    });
    marked = pick;
    const aimed = await page.evaluate((id) => window.__sh.aim(id), pick.id);
    await sleep(300);
    const keys = await page.evaluate(() => document.querySelector('#book-peek .peek-keys')?.textContent || '');
    await page.keyboard.press('c');
    await until((id) => !!window.__sh.placed()[id]?.read, pick.id);
    await settle(400);
    const after = await page.evaluate((id) => {
      const pl = window.__sh.placed()[id], b = window.__app.world.booksById[id];
      const rd = window.__sh.readCase();
      return { pl, finished: b.finished, finishedAt: b.finishedAt, first: rd ? window.__sh.caseOrder(rd)[0] : null, keys: document.querySelector('#book-peek .peek-keys')?.textContent || '', toast: window.__toasts.slice(-1)[0] || '' };
    }, pick.id);
    const p1 = await goal();
    log('MARK', { pick, aimed, keys, after, goal: p1 });
    check('the book card names C: "Als gelesen markieren"', aimed && /C\s*Als gelesen markieren/.test(keys), { aimed, keys });
    check('C on a book: it is read and stands on the case "Gelesen", first', after.finished && after.pl?.read && after.first === pick.id && /Gelesen/.test(after.toast), after);
    check('the reading goal counts it: 1 of 12 books', p1?.count === 1 && p1.target === 12, p1);
    // again, aimed at it on the case "Gelesen": back to its department
    const aimed2 = await page.evaluate((id) => window.__sh.aim(id), pick.id);
    const keys2 = await page.evaluate(() => document.querySelector('#book-peek .peek-keys')?.textContent || '');
    await page.keyboard.press('c');
    await until((id) => { const p = window.__sh.placed()[id]; return !!p && !p.read; }, pick.id);
    await settle(400);
    const back = await page.evaluate((id) => ({ pl: window.__sh.placed()[id], finished: window.__app.world.booksById[id].finished }), pick.id);
    const p2 = await goal();
    log('UNMARK', { aimed2, keys2, back, goal: p2 });
    check('C again ("Als ungelesen markieren"): back on its department shelf, the reading goal counts 0', aimed2 && /Als ungelesen markieren/.test(keys2) && !back.finished && back.pl && !back.pl.read && back.pl.case === pick.from && p2?.count === 0, { back, p2, keys2 });
  }

  // ------------------------------------------------------------------ reading to 97 %, newest first ----
  if (parts.includes('progress')) {
    const ids = await page.evaluate(async () => {
      const A = window.__app, sh = window.__sh;
      const a = sh.byTitle('Tod am Deich')[0], b = sh.byTitle('Blaue Stunde')[0], c = sh.byTitle('Mondlicht in Lissabon')[0];
      await A.ctx.api.library.update(a.id, { progress: 0.5, lastRead: Date.now() });
      await A.ctx.api.library.update(a.id, { progress: 0.985, lastRead: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
      await A.ctx.api.library.update(b.id, { progress: 1, lastRead: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
      await A.ctx.api.invoke('library:markRead', c.id, true);
      return [a.id, b.id, c.id];
    });
    await until((ids) => ids.every((id) => window.__sh.placed()[id]?.read), ids);
    await settle(400);
    const st = await page.evaluate((ids) => {
      const rd = window.__sh.readCase(), order = window.__sh.caseOrder(rd), placed = window.__sh.placed();
      return { order: order.slice(0, 4), onRead: ids.map((id) => !!placed[id]?.read), finished: ids.map((id) => window.__app.world.booksById[id].finished), display: rd.display };
    }, ids);
    const p = await goal();
    const ex = await page.evaluate(() => window.__sh.extras());
    log('PROGRESS', { ids, st, goal: p, extras: ex });
    check('read to 97 % (and 100 %), or marked: on the case "Gelesen", the latest first', st.onRead.every(Boolean) && st.finished.every(Boolean) && JSON.stringify(st.order.slice(0, 3)) === JSON.stringify([ids[2], ids[1], ids[0]]), st);
    check('the two read last lie face out on its board, the reading goal counts 3', st.display.length === 2 && st.display[0] === ids[2] && p?.count === 3, { display: st.display, p });
    check('the case with books: no card and no plaque either', ex.books === 3 && ex.cards === 0 && !ex.cardTexts.length && !ex.plaque && ex.signs.join() === 'Gelesen', ex);
    // going back to the start of a book keeps it read
    await page.evaluate((id) => window.__app.ctx.api.library.update(id, { progress: 0.1 }), ids[1]);
    await settle(1500);
    const still = await page.evaluate((id) => ({ finished: window.__app.world.booksById[id].finished, read: !!window.__sh.placed()[id]?.read }), ids[1]);
    check('reading it again from the start keeps it read', still.finished && still.read, still);
  }

  // ------------------------------------------------------------------ the setting switches the case off and on ----
  if (parts.includes('toggle')) {
    const before = await page.evaluate(() => ({ read: window.__sh.readCase()?.rows.reduce((a, r) => a + r.items.length, 0) || 0, cases: window.__app.world.layout.bookcases.length }));
    await setShelves({ finishedShelf: false });
    const off = await page.evaluate(() => {
      const A = window.__app, L = A.world.layout, placed = window.__sh.placed();
      const read = A.state.library.books.filter((b) => b.finished);
      return { rd: !!window.__sh.readCase(), sign: (L.signs || []).some((s) => s.kind === 'read'), place: A.world.layout.places.some((p) => p.id === 'finished'),
        readInDeps: read.filter((b) => placed[b.id] && !placed[b.id].read).length, read: read.length, wheel: !!A.ctx.world.readShelf() };
    });
    await setShelves({ finishedShelf: true });
    const on = await page.evaluate(() => ({ rd: !!window.__sh.readCase(), n: window.__sh.readCase()?.rows.reduce((a, r) => a + r.items.length, 0) || 0 }));
    log('TOGGLE', { before, off, on });
    check('setting off: no case "Gelesen", the books read stand in their departments again', !off.rd && !off.sign && !off.place && !off.wheel && off.read > 0 && off.readInDeps === off.read, off);
    check('setting on again: the case is back with the same books', on.rd && on.n === before.read, on);
  }

  // ------------------------------------------------------------------ duplicate books ----
  if (parts.includes('dupes')) {
    const D = async () => page.evaluate(() => {
      const A = window.__app, books = A.state.library.books, placed = window.__sh.placed();
      const groups = {};
      for (const b of books) if (b.dupGroup) (groups[b.dupGroup] ||= []).push(b);
      const g = Object.values(groups).map((list) => ({ title: list[0].title, n: list.length, placed: list.filter((b) => placed[b.id]).map((b) => b.format + ':' + b.relPath.replace(/\\/g, '/')) }));
      const plain = ['Rom Band 1', 'Rom Band 2', 'Grundkurs Statistik', 'Königsindisch'].flatMap((t) => books.filter((b) => b.title === t)).map((b) => ({ t: b.title, f: b.format, dup: !!b.dupGroup, placed: !!placed[b.id] }));
      return { groups: g.sort((a, b) => a.title.localeCompare(b.title)), plain, hidden: [...(A.world.layout.hidden || [])].length, placed: Object.keys(placed).length, books: books.length };
    });
    const on = await D();
    log('DUPES-ON', on);
    const want = { 'Das Gehirn': 2, 'Die Römer': 3, 'Kleine Geschichte des Meeres': 2 };
    check('three groups of copies are found (the same file, title and author, ISBN)', on.groups.length === 3 && on.groups.every((g) => want[g.title.replace(/ \(2\. Auflage\)|: Sachbuch/, '')] === g.n), on.groups.map((g) => [g.title, g.n]));
    check('with the setting on one copy of each stands: the EPUB before the PDF', on.groups.every((g) => g.placed.length === 1) && on.groups.find((g) => /Römer/.test(g.title)).placed[0].startsWith('epub:') && on.groups.find((g) => /Gehirn/.test(g.title)).placed[0].startsWith('epub:'), on.groups.map((g) => g.placed));
    check('volumes, other editions and a title without an author are no copies and always stand', on.plain.length === 6 && on.plain.every((b) => !b.dup && b.placed), on.plain);
    check('every book stands once: placed + hidden copies = all books', on.placed + on.hidden === on.books, { placed: on.placed, hidden: on.hidden, books: on.books });
    // the copy being read wins over the format
    const pdfId = await page.evaluate(() => window.__sh.byTitle('Die Römer', 'pdf').find((b) => /Geschichte/.test(b.relPath)).id);
    await page.evaluate((id) => window.__app.ctx.api.library.update(id, { progress: 0.3, lastRead: Date.now() }), pdfId);
    await until((id) => !!window.__sh.placed()[id], pdfId);
    await settle(400);
    const read = await page.evaluate((id) => !!window.__sh.placed()[id], pdfId);
    check('a copy that is being read stands instead (the progress wins over EPUB)', read, { pdfId });
    await setShelves({ dedupe: false });
    const off = await D();
    log('DUPES-OFF', { groups: off.groups.map((g) => g.placed.length), hidden: off.hidden, placed: off.placed });
    check('with the setting off every copy stands', off.hidden === 0 && off.groups.every((g) => g.placed.length === g.n), off.groups.map((g) => [g.title, g.placed.length]));
    await setShelves({ dedupe: true });
  }

  // ------------------------------------------------------------------ the sort orders ----
  const shelvesToCheck = [['Romane', 'Klassiker'], ['Romane', 'Krimis'], ['Reihen', 'Sternenfahrer'], ['Reihen', 'Chroniken'], ['Sachbücher', 'Geschichte'], ['Sachbücher', 'Wissenschaft']];
  if (parts.includes('sort')) {
    // the frames while the order changes (the loop runs, the window is hidden)
    await page.evaluate(() => {
      const w = window.__app.world;
      window.__frames = []; let last = performance.now();
      const tick = (t) => { window.__frames.push(t - last); last = t; window.__frameReq = requestAnimationFrame(tick); };
      window.__frameReq = requestAnimationFrame(tick);
      window.__rearr = [];
      const orig = w.rearrangeShelves.bind(w);
      w.rearrangeShelves = () => { const t = performance.now(); const casesBefore = w.layout.bookcases.map((b) => b.id).join(); const r = orig(); window.__rearr.push({ ms: +(performance.now() - t).toFixed(1), sameCases: casesBefore === w.layout.bookcases.map((b) => b.id).join() }); return r; };
    });
    const results = [];
    for (const mode of ['author', 'year', 'publisher', 'series', 'added', 'read', 'title']) {
      await page.evaluate(() => { window.__frames.length = 0; window.__rearr.length = 0; window.__atlas = window.__app.world.books.atlas; });
      await setShelves({ sort: mode });
      const data = await page.evaluate((list) => {
        const A = window.__app, w = A.world;
        const shelves = list.map(([d, s]) => ({ d, s, ids: window.__sh.shelfOrder(d, s) }));
        const by = {};
        for (const sh of shelves) for (const id of sh.ids || []) { const b = w.booksById[id]; by[id] = { id, title: b.title, author: b.author, year: b.year, publisher: b.publisher, series: b.series, seriesIndex: b.seriesIndex, addedAt: b.addedAt, born: b.born, lastRead: b.lastRead }; }
        return { shelves, by, frames: [...window.__frames], rearr: [...window.__rearr], kept: !!window.__atlas && w.books.atlas === window.__atlas };
      }, shelvesToCheck);
      const wrong = [];
      for (const sh of data.shelves) {
        if (!sh.ids) { wrong.push(sh.d + '/' + sh.s + ': missing'); continue; }
        const want = sortIds(sh.ids, data.by, mode);
        if (JSON.stringify(want) !== JSON.stringify(sh.ids)) wrong.push(`${sh.d}/${sh.s}: ${sh.ids.map((id) => data.by[id].title).join(' | ')}`);
      }
      const maxFrame = Math.max(0, ...data.frames.slice(1));
      results.push({ mode, wrong, rebuilds: data.rearr, kept: data.kept, maxFrame: +maxFrame.toFixed(1) });
      check(`sort "${mode}": every shelf stands in that order`, !wrong.length, wrong);
      if (mode === 'series') {
        const titles = (d, s) => data.shelves.find((x) => x.d === d && x.s === s).ids.map((id) => data.by[id].title);
        const ster = titles('Reihen', 'Sternenfahrer'), chron = titles('Reihen', 'Chroniken');
        log('SERIES', { ster, chron });
        check('"Reihe": the volumes in their order (Band 1, #2, (Band 3), Teil IV, Band 10), the rest after them; EPUB series metadata', JSON.stringify(ster) === JSON.stringify(['Sternenfahrer, Band 1: Aufbruch', 'Sternenfahrer #2: Die Leere', 'Heimkehr (Sternenfahrer, Band 3)', 'Sternenfahrer - Teil IV: Das Echo', 'Sternenfahrer Band 10', 'Abseits der Bahnen'])
          && JSON.stringify(chron) === JSON.stringify(['Das Erbe', 'Der Winter kommt', 'Am Ende des Eises', 'Begleitbuch zur Welt']), { ster, chron });
        // close to the shelf "Sternenfahrer": the volumes in their order on the spines
        await page.evaluate(() => {
          const w = window.__app.world, ids = window.__sh.shelfOrder('Reihen', 'Sternenfahrer');
          const a = w.books.entry(ids[0]), b = w.books.entry(ids[ids.length - 1]);
          const mid = a.pos.clone().lerp(b.pos, 0.5), right = { x: a.forward.z, z: -a.forward.x };
          const p = mid.clone().addScaledVector(a.forward, 0.95); p.x -= right.x * 0.18; p.z -= right.z * 0.18;
          w.player.transition = null; w.player.setPose(p.x, p.z, Math.atan2(a.forward.x, a.forward.z), Math.atan2(mid.y - 1.62, 0.95));
          for (let i = 0; i < 6; i++) w.frame();
        });
        await sleep(1200);
        await shot(`${tag}-series`);
      }
    }
    // the graphics card is shared with other work: a mode with a long frame is measured once more (from "title")
    for (const r of results.filter((x) => x.maxFrame >= 250)) {
      await setShelves({ sort: 'title' });
      await page.evaluate(() => { window.__frames.length = 0; window.__rearr.length = 0; });
      await setShelves({ sort: r.mode });
      const again = await page.evaluate(() => ({ frames: [...window.__frames], rearr: [...window.__rearr] }));
      r.retry = +Math.max(0, ...again.frames.slice(1)).toFixed(1);
      r.maxFrame = Math.min(r.maxFrame, r.retry);
    }
    if (results.some((x) => x.retry != null)) await setShelves({ sort: 'title' });
    // the same time without any change: how long the frames of this machine are anyway
    await page.evaluate(() => { window.__frames.length = 0; });
    await sleep(2000);
    const quiet = await page.evaluate(() => +Math.max(0, ...window.__frames.slice(1)).toFixed(1));
    await page.evaluate(() => cancelAnimationFrame(window.__frameReq));
    log('SORT', { quietMaxFrame: quiet, results });
    check('a new order rearranges only the shelves (the cases stay), without a long frame', results.every((r) => r.rebuilds.length >= 1 && r.rebuilds.every((x) => x.sameCases) && r.maxFrame < 250), results.map((r) => [r.mode, r.rebuilds, r.maxFrame, r.retry]));
    // the spines: books that only move keep their atlas cells (nothing drawn or put on the graphics card again), a new
    // title draws the atlases anew with it, the old title back as well
    const spines = await page.evaluate(async () => {
      const A = window.__app, w = A.world, b = window.__sh.byTitle('Die Hanse')[0];
      const until = async (f) => { for (let i = 0; i < 60 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };
      const a0 = w.books.atlas;
      w.refreshShelves();
      const kept = w.books.atlas === a0;
      const old = b.title, renamed = old + ' (Neuausgabe)';
      await A.ctx.api.invoke('library:update', b.id, { title: renamed });
      await until(() => w.booksById[b.id]?.title === renamed);
      w.refreshShelves();
      const a1 = w.books.atlas;
      const redrawn = a1 !== a0 && a1.key.includes(renamed);
      await A.ctx.api.invoke('library:update', b.id, { title: old });
      await until(() => w.booksById[b.id]?.title === old);
      w.refreshShelves();
      const back = w.books.atlas !== a1 && !w.books.atlas.key.includes(renamed) && w.books.atlas.key.includes(old);
      return { kept, redrawn, back, atlases: w.books.atlas.textures.length };
    });
    check('the spine atlases stay when books only move (every order, a refresh), a new title draws them anew', results.every((r) => r.kept) && spines.kept && spines.redrawn && spines.back, { orders: results.map((r) => [r.mode, r.kept]), spines });
  }

  // ------------------------------------------------------------------ the book info: read, other copies ----
  if (parts.includes('info')) {
    const id = await page.evaluate(() => window.__sh.byTitle('Die Römer', 'epub')[0].id);
    await page.evaluate((id) => window.__app.ctx.openPanel('bookinfo', { id }), id);
    await sleep(1200);
    const card = await page.evaluate(() => {
      const el = document.querySelector('.rd-bi');
      const rows = [...el.querySelectorAll('.rd-bi-copies .dup-copy')].map((r) => ({ facts: r.querySelector('.dup-copy-facts').textContent, folder: r.querySelector('.dup-copy-folder').textContent, buttons: [...r.querySelectorAll('button')].map((b) => b.textContent) }));
      return { head: el.querySelector('.rd-bi-copies-head')?.textContent, rows, read: el.querySelector('.rd-bi-read')?.textContent };
    });
    log('INFO', card);
    check('the book info: "Auch vorhanden als" with format, size, folder and "Im Explorer zeigen"', card.head === 'Auch vorhanden als:' && card.rows.length === 2 && card.rows.every((r) => /PDF/.test(r.facts) && /(KB|MB)/.test(r.facts) && /Sachbücher/.test(r.folder) && r.buttons.includes('Im Explorer zeigen')), card);
    await shot(`${tag}-bookinfo`);
    await page.evaluate(() => document.querySelector('.rd-bi .dup-copy button[data-act="reveal"]').click());
    const revealed = await page.evaluate(() => window.__revealed.slice());
    check('"Im Explorer zeigen" asks for exactly that file (the test records the call, no window opens)', revealed.length === 1 && revealed[0] !== id, revealed);
    await page.evaluate(() => document.querySelector('.rd-bi .rd-bi-read').click());
    await sleep(1500);
    const after = await page.evaluate((id) => ({ finished: window.__app.state.library.books.find((b) => b.id === id)?.finished, button: document.querySelector('.rd-bi .rd-bi-read')?.textContent, done: document.querySelector('.rd-bi .rd-bi-done')?.textContent }), id);
    check('"Als gelesen markieren" in the book info marks it and turns into "Als ungelesen markieren"', after.finished && /Als ungelesen markieren/.test(after.button) && /Gelesen am/.test(after.done || ''), after);
    await page.evaluate(() => window.__app.closeAllPanels());
    await settle(1200);
  }

  // ------------------------------------------------------------------ the list "Doppelte Bücher" ----
  if (parts.includes('list')) {
    await page.evaluate(() => window.__app.ctx.openPanel('settings', { section: 'library' }));
    await sleep(900);
    const row = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.settings-panel .setting')];
      const r = rows.find((x) => /Doppelte Bücher$/.test(x.querySelector('label')?.firstChild?.textContent || ''));
      const sel = document.querySelector('.settings-panel select.shelf-sort');
      return { found: !!r, hint: r?.querySelector('.setting-hint')?.textContent, sort: sel ? [...sel.options].map((o) => o.textContent) : null, goal: document.querySelector('.settings-panel input.shelf-goal')?.value,
        toggles: [...document.querySelectorAll('.settings-panel .setting label')].map((l) => l.firstChild?.textContent).filter((t) => /Gelesen|Doppelte/.test(t || '')) };
    });
    log('SETTINGS', row);
    check('the settings: sort order (7 choices), the case "Gelesen", the goal, duplicates with a count', row.found && row.sort?.length === 7 && row.goal === '12' && row.toggles.length >= 2 && /3 Bücher liegen mehrfach vor/.test(row.hint || ''), row);
    await page.evaluate(() => { const t = [...document.querySelectorAll('.settings-panel .settings-group')].find((x) => /Regale/.test(x.textContent)); t?.scrollIntoView({ block: 'start' }); });
    await sleep(300);
    await shot(`${tag}-settings`);
    await page.evaluate(() => { const r = [...document.querySelectorAll('.settings-panel .setting')].find((x) => /Doppelte Bücher$/.test(x.querySelector('label')?.firstChild?.textContent || '')); r.querySelector('button').focus(); });
    await page.keyboard.press('Enter');
    await sleep(1200);
    const list = await page.evaluate(() => {
      const p = document.querySelector('.dup-panel');
      return p ? { groups: [...p.querySelectorAll('.dup-group')].map((g) => ({ title: g.querySelector('.dup-title').textContent, copies: g.querySelectorAll('.dup-copy').length, shown: g.querySelectorAll('.dup-copy.shown').length, reveal: g.querySelectorAll('button[data-act="reveal"]').length })), intro: p.querySelector('.dup-intro')?.textContent } : null;
    });
    log('LIST', list);
    check('"Doppelte Bücher" (opened with the keyboard): three groups, every copy with its Explorer button, one marked as on the shelf', !!list && list.groups.length === 3 && list.groups.every((g) => g.copies >= 2 && g.reveal === g.copies && g.shown === 1), list);
    await shot(`${tag}-duplicates`);
    await page.evaluate(() => window.__app.closeAllPanels());
    await sleep(400);
  }

  // ------------------------------------------------------------------ the language field ----
  if (parts.includes('lang')) {
    const langs = await page.evaluate(() => window.__app.state.library.books.map((b) => [b.title, b.language ?? null]));
    const bad = langs.filter(([, l]) => l !== null && !/^[a-z]{2}$/.test(l));
    const garbage = langs.filter(([t]) => ['Die Hanse', 'Burgen am Rhein', 'Die Wikinger'].includes(t));
    log('LANG', garbage);
    check('every language is two letters or none (the garbage of the metadata is gone)', !bad.length && garbage.length === 3 && garbage.every(([, l]) => l === 'de'), { bad, garbage });
  }

  // ------------------------------------------------------------------ screenshots ----
  if (parts.includes('shots')) {
    // more books read, so that the case and its board show something
    await page.evaluate(async () => {
      const A = window.__app;
      const titles = ['Abendrot über dem Fjord', 'Der Uhrmacher von Brügge', 'Das Erbe', 'Der Winter kommt', 'Die Hanse', 'Ein Sommer am Haff', 'Kaffee mit Konstantin', 'Rom Band 1', 'Die siebte Spur'];
      for (const t of titles) { const b = A.state.library.books.find((x) => x.title === t); if (b) { await A.ctx.api.invoke('library:markRead', b.id, true); await new Promise((r) => setTimeout(r, 20)); } }
      for (let i = 0; i < 4; i++) await A.ctx.api.library.addReadingTime(A.state.library.books[0].id, 120);
    });
    await settle(2500);
    const views = await page.evaluate(() => {
      const w = window.__app.world, rd = window.__sh.readCase(), rc = w.layout.bookcases.find((b) => b.recent);
      const fx = Math.sin(rd.rot), fz = Math.cos(rd.rot);
      return [
        ['read', rd.x + fx * 1.55, rd.z + fz * 1.55, Math.atan2(fx, fz), -0.12],
        ['read-board', rd.x + fx * 0.95, rd.z + fz * 0.95, Math.atan2(fx, fz), -0.55],
        ['read-room', -1.0, -13.8, Math.atan2(rd.x + 1.0, rd.z + 13.8) + Math.PI, 0.1],
        ['entrance-wall', 0, -14.5, Math.PI, 0.12],
      ];
    });
    for (const [name, x, z, yaw, pitch] of views) {
      await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); for (let i = 0; i < 6; i++) w.frame(); }, [x, z, yaw, pitch]);
      await sleep(1500);
      await shot(`${tag}-${name}`);
    }
    const full = await page.evaluate(() => window.__sh.extras());
    log('FULL', full);
    check('the full case "Gelesen": books on its shelves and two on its board, no card, no plaque', full.books >= 10 && full.display === 2 && full.cards === 0 && !full.cardTexts.length && !full.plaque && full.signs.join() === 'Gelesen', full);
    // the book card of a book on the case "Gelesen": the ribbon and C "Als ungelesen markieren"
    const cardInfo = await page.evaluate(() => {
      const rd = window.__sh.readCase(), id = window.__sh.caseOrder(rd)[2];
      const ok = window.__sh.aim(id);
      return { ok, id };
    });
    await sleep(900);
    const card = await page.evaluate(() => ({ ribbon: document.querySelector('#book-peek .peek-read')?.textContent || '', keys: document.querySelector('#book-peek .peek-keys')?.textContent || '' }));
    log('CARD', { ...cardInfo, ...card });
    check('the card of a book read shows the ribbon "Gelesen" and C "Als ungelesen markieren"', cardInfo.ok && /Gelesen/.test(card.ribbon) && /C\s*Als ungelesen markieren/.test(card.keys), card);
    await shot(`${tag}-card`);
    // the computer's statistics: the reading goal of the year with the books read, the streak
    await page.evaluate(() => window.__app.ctx.openPanel('computer', { section: 'stats' }));
    await sleep(1800);
    const stats = await page.evaluate(() => ({ head: document.querySelector('.term-goal .term-card-h')?.textContent || '', big: document.querySelector('.term-goal .term-goal-big')?.textContent || '', covers: document.querySelectorAll('.term-goal .term-goal-book').length, streak: [...document.querySelectorAll('.term-kpi')].map((k) => k.textContent).find((t) => /Lesesträhne/.test(t)) || '' }));
    log('STATS', stats);
    check('the statistics show the goal of the year with the books read and the streak', /Leseziel \d{4}/.test(stats.head) && /von 12 Büchern/.test(stats.big) && stats.covers > 3 && /1 Tag in Folge/.test(stats.streak), stats);
    await shot(`${tag}-stats`);
    await page.evaluate(() => window.__app.closeAllPanels());
    await sleep(700);
    // English: the sign and the book card follow the language at once; the full case shows no card and no plaque
    await setLanguage('en');
    await settle(900);
    const en = await page.evaluate(() => ({ extras: window.__sh.extras(), keys: document.querySelector('#book-peek .peek-keys')?.textContent || '', ribbon: document.querySelector('#book-peek .peek-read')?.textContent || '', chip: document.querySelector('#hud .hud-chip.dep')?.textContent || '' }));
    log('ENGLISH', en);
    check('English: the card says "Mark as unread", the full case shows its sign "Read", no card, no plaque', /Mark as unread/.test(en.keys) && /Read/.test(en.ribbon) && en.extras.cards === 0 && !en.extras.cardTexts.length && !en.extras.plaque && en.extras.signs.join() === 'Read', en);
    const views2 = await page.evaluate(() => { const rd = window.__sh.readCase(), fx = Math.sin(rd.rot), fz = Math.cos(rd.rot); return [['read-en', rd.x + fx * 1.55, rd.z + fz * 1.55, Math.atan2(fx, fz), 0.05]]; });
    for (const [name, x, z, yaw, pitch] of views2) {
      await page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; w.player.transition = null; w.player.setPose(x, z, yaw, pitch); for (let i = 0; i < 6; i++) w.frame(); }, [x, z, yaw, pitch]);
      await sleep(1500);
      await shot(`${tag}-${name}`);
    }
    await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'de' }));
    await settle(800);
  }

  const errs = errors.filter((e) => !/Autoplay|favicon|ERR_FILE_NOT_FOUND/.test(e));
  check('no renderer errors', !errs.length, errs.slice(0, 5));
  console.log(`SHELVES-CHECK ${failures ? 'FAILED' : 'OK'} passed=${passes} failed=${failures}`);
};
