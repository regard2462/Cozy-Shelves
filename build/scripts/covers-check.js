// Covers from the internet, the whole flow in the app: page 1 judged (blank, plain text, a stamp, one flat colour, a
// real cover), the search in the background (the book catalogues first: Open Library, Apple Books, the DNB; the image
// search of Bing, Yandex and DuckDuckGo for what they do not know), the stored covers, the metadata the catalogues fill
// in, the live update of the world, the hover card and the computer's catalogue, the book info card ("Anderes Cover"
// with the catalogues' pictures, "Eigenes Bild wählen", "Generiertes Titelbild", "Cover aus dem Buch") and the settings
// ("Alle Cover jetzt laden", both switches, the image search engines, German and English).
//   python build/testlib/gen_covers_lib.py <scratch>\lib
//   COZYSHELVES_BOOKS="<scratch>\lib|structured" COZYSHELVES_USERDATA=<fresh folder> SHOT_DIR=<folder>
//   COZYSHELVES_COVERS_FIXTURES=<folder> COZYSHELVES_COVERS_PAUSE=0 node build/screenshot.js covers-check
// Test runs stay off the network (web-covers.js): COZYSHELVES_COVERS_FIXTURES answers every request from responses saved in
// that folder; with COZYSHELVES_COVERS_RECORD=1 a run asks the real catalogues and image search engines (with their real
// pauses and budgets) for what is missing there and saves it (never DuckDuckGo: that needs COZYSHELVES_COVERS_RECORD_DDG=1
// as well, and DuckDuckGo turns an address away for a quarter of an hour after six or seven searches: keep
// COZYSHELVES_COVERS_PAUSE at 180000 for that). COZYSHELVES_COVERS_LIVE=1 uses the
// network without saving. COVERS_WAIT (minutes, default 30) limits the wait for the search. COVERS_CATALOGUES=0: the
// fixtures hold DuckDuckGo's answers only (the folder of 0.6), no catalogue is expected to answer.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// what page 1 of each test book is (build/testlib/gen_covers_lib.py) and what the check must say about it
const EXPECT = { blank: 'blank', pagenumber: 'blank', title: 'text', bodytext: 'text', scan: 'text', stamp: 'text', uniform: 'uniform', cover: null, darkcover: null };
const MADE_UP = ['Die vergessene Kartografie der Nebelinseln', 'Quantum Gardening for Retired Lighthouse Keepers', 'Das Haushaltsbuch'];
const KNOWN = ['Frankenstein', 'Die Leiden des jungen Werthers', 'Der grüne Heinrich', 'Der Schimmelreiter', 'Kabale und Liebe', 'Michael Kohlhaas', 'Kleines Lehrbuch des Schachspiels', 'Der Wohlstand der Nationen', 'Die protestantische Ethik und der Geist des Kapitalismus', 'The Voyage of the Beagle', 'Woyzeck'];
const CATALOGUES = process.env.COVERS_CATALOGUES !== '0';

/** A small PNG of one colour with a darker band (the reader's "own picture"), w × h. */
function png(w, h) {
  const crc = (buf) => { let c, n, t = []; for (n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const band = y > h * 0.3 && y < h * 0.45; raw[o] = band ? 30 : 40 + (x * 180) / w; raw[o + 1] = band ? 40 : 120; raw[o + 2] = band ? 90 : 200 - (y * 120) / h; }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async ({ app, page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const books = (process.env.COZYSHELVES_BOOKS || '').split('|')[0];
  const manifestFile = path.join(path.dirname(books), path.basename(books) + '-manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : [];

  // ---- boot, index ---------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n >= manifest.length && st.idx === st.n && !st.active) break;
    await sleep(1000);
  }
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  const lib = () => page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, title: b.title, author: b.author, rel: b.relPath, year: b.year, publisher: b.publisher || null, isbn: b.isbn || null, series: b.series || null, metaWeb: b.metaWeb || null,
    coverGenerated: b.coverGenerated, coverWeak: b.coverWeak || null, coverSource: b.coverSource || null, coverWeb: b.coverWeb || null, coverVersion: b.coverVersion || 0, coverChoice: b.coverChoice || null })));
  const byRel = (list, rel) => list.find((b) => b.rel === rel);

  // ---- page 1 judged ---------------------------------------------------------------------------------------------------
  let list = await lib();
  const judged = manifest.map((m) => { const b = byRel(list, m.rel); return { title: m.title, kind: m.kind, weak: b?.coverWeak ?? null, generated: !!b?.coverGenerated }; });
  for (const j of judged) {
    if (j.kind === 'text') check(`a text file gets the title card (${j.title})`, j.generated, j);
    else check(`page 1 "${j.kind}" is judged ${EXPECT[j.kind] || 'a real cover'} (${j.title})`, j.weak === EXPECT[j.kind], j);
  }

  // ---- the search in the background ------------------------------------------------------------------------------------
  const waitMin = +(process.env.COVERS_WAIT || 30);
  const t0 = Date.now();
  let status = null;
  for (;;) {
    status = await page.evaluate(() => window.__app.ctx.api.invoke('covers:status'));
    if (status.pending === 0 && !status.waiting && !status.checking && !status.current) break;
    if (Date.now() - t0 > waitMin * 60e3) break;
    await sleep(3000);
  }
  const searchSecs = Math.round((Date.now() - t0) / 1000);
  console.log('STATUS ' + JSON.stringify({ ...status, seconds: searchSecs }));
  list = await lib();
  for (const m of manifest) {
    const b = byRel(list, m.rel);
    console.log(`  ${(b?.coverSource || '-').padEnd(4)} ${String(b?.coverWeb?.via || '').padEnd(11)} ${String(b?.coverWeb?.site || '').padEnd(24)} ${m.kind.padEnd(10)} ${m.title}` + (b?.metaWeb?.src ? '  meta: ' + Object.entries(b.metaWeb.src).map(([k, v]) => `${k}=${v}`).join(',') : ''));
  }
  const known = manifest.filter((m) => KNOWN.includes(m.title)).map((m) => byRel(list, m.rel));
  const got = known.filter((b) => b?.coverSource === 'web');
  check('most well-known books got a cover from the internet', got.length >= Math.ceil(known.length * 0.7), { got: got.length, of: known.length });
  if (CATALOGUES) {
    const fromCatalogues = got.filter((b) => ['openlibrary', 'apple', 'dnb', 'google'].includes(b.coverWeb?.via));
    check('the book catalogues come first: most covers are theirs, the image search only for the rest', fromCatalogues.length >= Math.ceil(got.length * 0.6), { catalogues: fromCatalogues.length, of: got.length, via: got.map((b) => b.coverWeb?.via) });
  }
  const madeUp = manifest.filter((m) => MADE_UP.includes(m.title)).map((m) => byRel(list, m.rel));
  check('made-up titles get no cover (better none than a wrong one)', madeUp.every((b) => b && b.coverSource !== 'web'), madeUp.map((b) => b?.coverWeb?.site || null));
  const texts = manifest.filter((m) => m.kind === 'text').map((m) => byRel(list, m.rel));
  check('a text file keeps its title card: notes and documents never go to a search engine', texts.length && texts.every((b) => b && b.coverSource !== 'web' && b.coverGenerated && !b.metaWeb), texts.map((b) => b?.title));
  const controls = manifest.filter((m) => m.kind === 'cover' || m.kind === 'darkcover').map((m) => byRel(list, m.rel));
  check('books with a real cover on page 1 keep it', controls.every((b) => b && b.coverSource !== 'web' && !b.coverWeak), controls.map((b) => b?.title));
  const userData = await page.evaluate(() => window.__app.ctx.api.app.info().then((i) => i.userData));
  for (const b of got) {
    const file = path.join(userData, 'covers', b.id + '.jpg');
    const keep = path.join(userData, 'covers', b.id + '.book.jpg');
    const out = path.join(process.env.SHOT_DIR || '.', 'cover-' + b.title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) + '.jpg');
    try { fs.copyFileSync(file, out); } catch {}
    check(`the web cover of "${b.title}" is stored, the book's own one kept`, fs.existsSync(file) && fs.existsSync(keep) && fs.statSync(file).size > 8000, { site: b.coverWeb?.site, via: b.coverWeb?.via, size: fs.existsSync(file) ? fs.statSync(file).size : 0 });
  }
  // the metadata: only what the file does not say, with where it came from
  if (CATALOGUES) {
    const filled = list.filter((b) => b.metaWeb?.src && Object.keys(b.metaWeb.src).length);
    check('the catalogues filled in metadata the files lack, and say where it came from', filled.length >= 3, filled.map((b) => `${b.title}: ${Object.entries(b.metaWeb.src).map(([k, v]) => `${k}=${v}`).join(',')}`));
    const werther = list.find((b) => /Leiden des jungen Werthers/.test(b.title));
    check('what the file says stays (title and author from the PDF\'s metadata)', werther && werther.author === 'Johann Wolfgang von Goethe' && !werther.metaWeb?.src?.author, { author: werther?.author, src: werther?.metaWeb?.src });
  }

  // ---- the world, the hover card, the catalogue and the info card follow without a rebuild --------------------------
  const target = got.find((b) => b.rel === manifest.find((m) => m.title === 'Frankenstein')?.rel) || got[0];
  if (target) {
    await page.evaluate(() => {
      const w = window.__app.world, p = w.player;
      window.__cv = {
        /** stand 1.1 m in front of a shelf book, look at it, run the look ray and a few frames */
        aim(id) {
          const e = w.books.entry(id);
          if (!e) return null;
          if (w.actions.seatedId || p.seated) w.actions.leaveSeat?.();
          const x = e.pos.x + e.forward.x * 1.1, z = e.pos.z + e.forward.z * 1.1;
          p.transition = null;
          // look up first: a book still out of its shelf (a neighbour) keeps the look ray on itself
          p.setPose(x, z, 0, 1.2);
          p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld();
          w.actions.rayTimer = 0; w.actions.update(0.001);
          for (let i = 0; i < 30; i++) w.books.update(1 / 60, w.camera);
          p.setPose(x, z, Math.atan2(-(e.pos.x - x), -(e.pos.z - z)), Math.atan2(e.pos.y - 1.62, Math.hypot(e.pos.x - x, e.pos.z - z)));
          p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld();
          w.actions.rayTimer = 0; w.actions.update(0.001);
          return w.actions.target?.book?.id || null;
        },
        frames(n) { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); w.frame(); t.push(performance.now() - a); } return t; },
        slot(id) { const s = w.books.slots.find((x) => x.entry?.book.id === id && x.target > 0); return s ? { typo: s.typo, waiting: !!s.waiting, cover: !!s.front.map?.userData?.cover, book: s.entry.book.coverSource || null } : null; },
        // the hover card: the cover image, or the title card the HUD draws as a canvas at the card's size (hud.js typoCanvas)
        peek() { const c = document.querySelector('#book-peek.show'); if (!c) return null; if (c.querySelector('canvas.peek-typo')) return 'canvas:typo'; return c.querySelector('img')?.getAttribute('src') || null; },
      };
    });
    const look = async (id) => { await page.evaluate((x) => window.__cv.aim(x), id); await page.evaluate(() => window.__cv.frames(40)); await sleep(600); await page.evaluate(() => window.__cv.frames(10)); return { slot: await page.evaluate((x) => window.__cv.slot(x), id), peek: await page.evaluate(() => window.__cv.peek()) }; };
    // a short library is indexed within the 9 s main.js waits before it rebuilds the shelves: the rebuild must use the
    // newest records (the covers of the books indexed meanwhile) and must not bring back the "einsortiert" chip
    const chip = await page.evaluate(() => document.querySelector('#scan-status')?.textContent || '');
    const stale = await page.evaluate(() => window.__app.state.library.books.filter((b) => { const e = window.__app.world.books.entry(b.id); return e && (e.book.coverVersion || 0) !== (b.coverVersion || 0); }).length);
    check('the shelves hold the newest records and the scan chip is gone after indexing', !chip && stale === 0, { chip, stale });
    const builds0 = await page.evaluate(() => { window.__shelves = window.__app.world.shelfGroup; return window.__app.world.buildTimes.length; });
    const aimed = await page.evaluate((id) => window.__cv.aim(id), target.id);
    const seen0 = await look(target.id);
    check('the pulled-out book shows the cover from the internet', aimed === target.id && seen0.slot && seen0.slot.cover && !seen0.slot.typo && seen0.slot.book === 'web', { aimed, slot: seen0.slot });
    check('the hover card shows it (a fresh address per cover version)', new RegExp(`^cover://${target.id}/${target.id}\\.jpg\\?v=\\d+$`).test(seen0.peek || ''), seen0.peek);
    await shot('covers-hover-web');
    // a made-up title keeps the title card, in the room and on the card
    const fake = madeUp.find((b) => b && b.coverWeak);
    if (fake) {
      const s = await look(fake.id);
      check('a book without a cover anywhere shows its title card, not its blank or text page', s.slot && s.slot.typo && /^(data:image\/jpeg|canvas:typo)/.test(s.peek || ''), { slot: s.slot, peek: (s.peek || '').slice(0, 30) });
      await shot('covers-hover-titlecard');
      await look(target.id);
    }

    // the reader picks another picture while the book is out: it changes in place, no rebuild, no hitch
    const before = await page.evaluate(() => window.__cv.frames(30));
    const cands = await page.evaluate((id) => window.__app.ctx.api.invoke('covers:candidates', id), target.id);
    check('"Anderes Cover" lists the pictures of the catalogues and the image search, the current one marked', cands.ok && cands.items.length >= 2 && cands.items.filter((x) => x.current).length === 1,
      cands.ok ? cands.items.map((x) => `${x.source}:${x.site}${x.current ? '*' : ''}`) : cands);
    const pick = cands.ok ? cands.items.find((x) => !x.current) : null;
    let after = [];
    if (pick) {
      const v0 = (await lib()).find((b) => b.id === target.id).coverVersion;
      // every frame with the uploads it did (a long frame with an upload in it would be the new cover's fault)
      await page.evaluate(() => { window.__fx = []; });
      const res = await page.evaluate(([id, key]) => window.__app.ctx.api.invoke('covers:choose', id, key), [target.id, pick.key]);
      for (let i = 0; i < 20; i++) {
        after.push(...await page.evaluate(() => { const w = window.__app.world, t = []; for (let k = 0; k < 6; k++) { const u = w.books.coverStats.uploads, a = performance.now(); w.frame(); const ms = performance.now() - a; t.push(ms); window.__fx.push([Math.round(ms * 10) / 10, w.books.coverStats.uploads - u]); } return t; }));
        await sleep(100);
      }
      const slowest = await page.evaluate(() => [...window.__fx].sort((a, b) => b[0] - a[0]).slice(0, 4));
      const upl = await page.evaluate(() => { const s = window.__app.world.books.coverStats; return { uploads: s.uploads, uploadMaxMs: Math.round(s.max * 10) / 10, typoMaxMs: Math.round(s.typoMax * 10) / 10 }; });
      console.log('SLOWEST FRAMES [ms, uploads] ' + JSON.stringify(slowest) + ' ' + JSON.stringify(upl));
      const now = (await lib()).find((b) => b.id === target.id);
      const s2 = await page.evaluate((id) => window.__cv.slot(id), target.id);
      check('the chosen picture becomes the cover and stays (no automatic search replaces it)', res.ok && now.coverVersion > v0 && now.coverChoice === 'web' && now.coverWeb?.site === pick.site, { site: now.coverWeb?.site, choice: now.coverChoice });
      const same = await page.evaluate((n) => window.__app.world.buildTimes.length === n && window.__app.world.shelfGroup === window.__shelves, builds0);
      check('the book in the hand changes its front without a rebuild', s2 && s2.cover && !s2.typo && same, { slot: s2, sameShelves: same });
      const worst = (t) => Math.round(Math.max(...t) * 10) / 10;
      const median = (t) => Math.round([...t].sort((a, b) => a - b)[t.length >> 1] * 10) / 10;
      console.log('FRAMES before ' + JSON.stringify({ median: median(before), max: worst(before) }) + ' while the cover changes ' + JSON.stringify({ median: median(after), max: worst(after) }));
      check('no hitch while the cover changes (the worst frame stays below 50 ms)', worst(after) < 50, { before: worst(before), after: worst(after) });
    }

    // the info card: the source, "Anderes Cover" with the catalogues' pictures and the other choices, reachable by keyboard
    await page.evaluate((id) => window.__app.openPanel('bookinfo', { id }), target.id);
    await page.waitForSelector('.rd-bi-cover-tools', { timeout: 15000 });
    const src = await page.evaluate(() => document.querySelector('.rd-bi-cover-src')?.textContent || '');
    const info = await page.evaluate(() => [...document.querySelectorAll('.rd-bi-cover-tools button')].map((b) => b.textContent));
    check('the info card names where the cover comes from and offers "Anderes Cover"', /Cover von \S+/.test(src) && info.some((t) => /^Anderes Cover$/.test(t)), { src, info });
    await page.evaluate(() => [...document.querySelectorAll('.rd-bi-cover-tools button')].find((b) => /^Anderes Cover$/.test(b.textContent)).click());
    await page.waitForSelector('.rd-bi-pick-grid', { timeout: 60000 }).catch(() => {});
    await sleep(500);
    const tiles = await page.evaluate(() => [...document.querySelectorAll('.rd-bi-pick-item')].map((t) => ({ tag: t.tagName, current: t.classList.contains('current'), act: t.classList.contains('rd-bi-pick-act'), img: !!t.querySelector('img')?.naturalWidth, label: t.querySelector('.rd-bi-pick-site')?.textContent || '' })));
    const pictures = tiles.filter((t) => !t.act);
    check('the choice shows the pictures with their catalogue or site, the current one marked', pictures.length >= 2 && pictures.filter((t) => t.current).length === 1 && pictures.every((t) => t.img && t.label), pictures.slice(0, 8));
    const acts = tiles.filter((t) => t.act).map((t) => t.label);
    check('and "Eigenes Bild wählen", "Generiertes Titelbild" and "Cover aus dem Buch"', ['Eigenes Bild wählen', 'Generiertes Titelbild', 'Cover aus dem Buch'].every((l) => acts.includes(l)), acts);
    check('every choice is a button the keyboard reaches', tiles.length && tiles.every((t) => t.tag === 'BUTTON'), tiles.map((t) => t.tag));
    const webBtn = await page.evaluate(() => [...document.querySelectorAll('.rd-bi-pick-foot button')].map((b) => b.textContent));
    check('the image search only on request ("Im Web suchen")', webBtn.some((t) => /Im Web suchen/.test(t)) || pictures.some((t) => /\./.test(t.label)), webBtn);
    await shot('covers-bookinfo-choice');
    // "Generiertes Titelbild": the title card, in the room and on the card, for good
    await page.evaluate(() => [...document.querySelectorAll('.rd-bi-pick-item')].find((b) => /Generiertes Titelbild/.test(b.textContent)).click());
    await sleep(800);
    let rec = (await lib()).find((b) => b.id === target.id);
    const card = await page.evaluate(() => document.querySelector('.rd-bi-cover-src')?.textContent || '');
    check('"Generiertes Titelbild": the book shows its title card, the search leaves it alone', rec.coverChoice === 'card' && rec.coverSource === 'book' && /Generiertes Titelbild/.test(card), { choice: rec.coverChoice, source: rec.coverSource, card });
    await page.evaluate(() => window.__app.closeAllPanels());
    const sCard = await look(target.id);
    check('the pulled-out book and the hover card show the title card at once', sCard.slot && sCard.slot.typo && /^(data:image\/jpeg|canvas:typo)/.test(sCard.peek || ''), { slot: sCard.slot, peek: (sCard.peek || '').slice(0, 30) });
    await shot('covers-hover-chosen-card');
    // "Eigenes Bild wählen" (the file dialog is the system's: a test hands the file over directly)
    const ownFile = path.join(process.env.SHOT_DIR || path.dirname(books), 'eigenes-bild.png');
    fs.writeFileSync(ownFile, png(400, 600));
    const ownRes = await page.evaluate(([id, f]) => window.__app.ctx.api.invoke('covers:chooseFile', id, f), [target.id, ownFile]);
    await sleep(600);
    rec = (await lib()).find((b) => b.id === target.id);
    const sOwn = await look(target.id);
    check('"Eigenes Bild wählen": the picture becomes the cover, in the room at once', ownRes.ok && rec.coverChoice === 'own' && rec.coverWeb?.via === 'file' && sOwn.slot?.cover && !sOwn.slot?.typo, { choice: rec.coverChoice, via: rec.coverWeb?.via, slot: sOwn.slot });
    await shot('covers-hover-own-picture');
    // the catalogue at the computer shows the same cover and follows a change
    await page.evaluate(() => window.__app.openPanel('computer', { section: 'catalog' }));
    await page.waitForSelector(`img[data-cover-id="${target.id}"]`, { timeout: 15000 }).catch(() => {});
    const catBefore = await page.evaluate((id) => document.querySelector(`img[data-cover-id="${id}"]`)?.getAttribute('src') || null, target.id);
    await page.evaluate((id) => window.__app.ctx.api.invoke('covers:useBook', id), target.id);
    await sleep(800);
    const catAfter = await page.evaluate((id) => document.querySelector(`img[data-cover-id="${id}"]`)?.getAttribute('src') || null, target.id);
    const own = (await lib()).find((b) => b.id === target.id);
    check('"Cover aus dem Buch": back to the book\'s own cover, and the search leaves it alone', own.coverSource === 'book' && own.coverChoice === 'book' && !own.coverWeb, { source: own.coverSource, choice: own.coverChoice });
    check('the catalogue picture follows at once (page 1 of the book again)', /^cover:/.test(catBefore || '') && /^cover:/.test(catAfter || '') && catAfter !== catBefore, { catBefore, catAfter });
    await shot('covers-catalog');
    await page.evaluate(() => window.__app.closeAllPanels());
    const status2 = await page.evaluate(() => window.__app.ctx.api.invoke('covers:status'));
    check('a book set back to its own cover is not searched again', status2.pending === 0, { pending: status2.pending, waiting: status2.waiting });
  }

  // ---- the settings: both switches, the progress, "Alle Cover jetzt laden", German and English ----------------------
  await page.evaluate(() => window.__app.openPanel('settings', { section: 'library' }));
  await page.waitForSelector('.settings-content', { timeout: 15000 });
  await sleep(1500);
  const rows = () => page.evaluate(() => {
    const row = (re) => { const r = [...document.querySelectorAll('.setting')].find((x) => re.test(x.querySelector('label')?.textContent || '')); return r ? { on: r.querySelector('.toggle')?.classList.contains('on'), role: r.querySelector('.toggle')?.getAttribute('role'), tab: r.querySelector('.toggle')?.tabIndex } : null; };
    return { covers: row(/^(Fehlende Cover aus dem Internet laden|Load missing covers from the internet)/), meta: row(/^(Metadaten aus dem Internet ergänzen|Complete metadata from the internet)/),
      status: document.querySelector('.cv-status')?.textContent || '', buttons: [...document.querySelectorAll('.cv-batch button')].map((b) => b.textContent), batch: document.querySelector('.cv-batch')?.textContent || '' };
  });
  let r = await rows();
  check('both switches are there, on by default and reachable by keyboard', r.covers?.on === true && r.meta?.on === true && r.covers.tab === 0 && r.meta.tab === 0, r);
  // the image search engines: one button each that keeps its state; off, an engine is never asked
  const engines = () => page.evaluate(() => [...document.querySelectorAll('.cv-engines button')].map((b) => ({ label: b.textContent, pressed: b.getAttribute('aria-pressed'), tab: b.tabIndex })));
  let eng = await engines();
  check('"Bildersuche mit": Bing, Yandex and DuckDuckGo, all on by default, buttons the keyboard reaches', eng.map((e) => e.label).join() === 'Bing,Yandex,DuckDuckGo' && eng.every((e) => e.pressed === 'true' && e.tab === 0), eng);
  await page.evaluate(() => [...document.querySelectorAll('.cv-engines button')].find((b) => b.textContent === 'Yandex').click());
  await sleep(500);
  eng = await engines();
  const off = await page.evaluate(() => window.__app.ctx.api.invoke('covers:status').then((x) => x.engines));
  check('a click switches an engine off (stored in the settings, the search leaves it out)', eng.find((e) => e.label === 'Yandex')?.pressed === 'false' && off.yandex.on === false && off.bing.on === true, { eng, off });
  await page.evaluate(() => [...document.querySelectorAll('.cv-engines button')].find((b) => b.textContent === 'Yandex').click());
  await sleep(500);
  eng = await engines();
  check('and on again', eng.every((e) => e.pressed === 'true'), eng);
  // the reader's key for Google Books: kept as typed, in a field that hides it, and emptied again (a made-up test value)
  const keyField = await page.$('.cv-key');
  await keyField.fill('TEST-KEY-123'); await sleep(1300);
  const key1 = await page.evaluate(() => ({ stored: window.__app.state.settings.googleBooksKey, type: document.querySelector('.cv-key')?.type }));
  await (await page.$('.cv-key')).fill(''); await sleep(1300);
  const key2 = await page.evaluate(() => window.__app.state.settings.googleBooksKey);
  check('the key for Google Books is kept as typed in a hidden field, and emptied again', key1.stored === 'TEST-KEY-123' && key1.type === 'password' && key2 === '', { key1, key2 });
  // a switch keeps its new state (every change of the settings draws the section again)
  const flipMeta = () => page.evaluate(() => [...document.querySelectorAll('.setting')].find((x) => /^Metadaten aus dem Internet/.test(x.querySelector('label')?.textContent || '')).querySelector('.toggle').click());
  const metaState = () => page.evaluate(() => ({ ui: [...document.querySelectorAll('.setting')].find((x) => /^Metadaten aus dem Internet/.test(x.querySelector('label')?.textContent || ''))?.querySelector('.toggle')?.getAttribute('aria-checked'), stored: window.__app.state.settings.webMetadata }));
  await flipMeta(); await sleep(600);
  const m1 = await metaState();
  await flipMeta(); await sleep(600);
  const m2 = await metaState();
  check('a switch shows its new state at once and keeps it (off, then on again)', m1.ui === 'false' && m1.stored === false && m2.ui === 'true' && m2.stored === true, { m1, m2 });
  check('the progress line says how far the covers have come', /Cover aus dem Internet/.test(r.status), r.status);
  const startOff = await page.evaluate(() => [...document.querySelectorAll('.cv-batch button')].find((b) => b.textContent === 'Alle Cover jetzt laden')?.disabled);
  check('"Alle Cover jetzt laden" is there (off while no book is left)', r.buttons.includes('Alle Cover jetzt laden') && startOff === true && /Kein Buch mehr offen/.test(r.batch), { buttons: r.buttons, disabled: startOff, text: r.batch });
  // "Erneut versuchen": the books without a match go through the catalogues again, with the progress in the panel
  const missed0 = (await page.evaluate(() => window.__app.ctx.api.invoke('covers:status'))).missed;
  await page.evaluate(() => [...document.querySelectorAll('.cv-batch button')].find((b) => b.textContent === 'Erneut versuchen').click());
  let st3 = null;
  for (let i = 0; i < 60; i++) { st3 = await page.evaluate(() => window.__app.ctx.api.invoke('covers:status')); if (st3.batch.state === 'done') break; await sleep(500); }
  await sleep(600);
  r = await rows();
  check('"Erneut versuchen" asks the catalogues again about the books without a match, and says how it went', st3.batch.state === 'done' && st3.batch.total === missed0 && st3.batch.done === missed0 && /Fertig: \d+ Cover gefunden, \d+ nicht gefunden/.test(r.batch), { batch: { state: st3.batch.state, total: st3.batch.total, done: st3.batch.done }, missed0, text: r.batch });
  await shot('covers-settings');
  await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'en' }));
  await sleep(1500);
  r = await rows();
  const engLabel = await page.evaluate(() => document.querySelector('.cv-engines')?.closest('.setting')?.querySelector('label')?.textContent || '');
  check('the language switch changes the texts at once', r.covers && r.meta && r.buttons.includes('Load all covers now') && /covers from the internet/.test(r.status) && /^Image search with/.test(engLabel), { buttons: r.buttons, status: r.status, engLabel });
  await shot('covers-settings-en');
  await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'de' }));
  await sleep(500);
  await page.evaluate(() => window.__app.closeAllPanels());

  const failed = results.filter((x) => !x.ok);
  if (errors.length) console.log('page errors: ' + errors.slice(0, 5).join(' | '));
  console.log(`COVERS-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
