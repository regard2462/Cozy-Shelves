// Check: the diagram snip of the reader's chess pane, on the test library of build/testlib/gen_chess.py:
//   * opens Schach/Diagramme im Test.pdf (image, vector and scanned diagrams with captions), presses D, drags a
//     rectangle over each diagram like a user and compares the position, the side to move and the orientation
//     with the truth (chess-truth.json next to the library)
//   * Esc cancels a snip, the confidence and the uncertain squares are shown, a square fixed by hand changes
//     the position and is remembered for the book (IndexedDB)
//   * Schach/Diagramme im E-Book.epub: diagrams as pictures in an EPUB, captured at their own resolution, the side
//     to move read from the caption under the picture
//   * Schach/Unbekannte Figuren.pdf: a piece set no template knows; every diagram is corrected square by square,
//     and the later diagrams must come out better than the same snips read without the book's corrections
//   * a diagram in the style of a printed chess book (hatched dark squares, arrows over the board, coordinates on four
//     sides; build/testlib/fixtures, drawn by gen_chess.py fixtures) must
//     come out exactly, with an honest confidence; the card and the move entry speak German, switch to English
//     with the app language while the card is open, and back
// CHESS_DUMP=<file> also writes the app's template boards for build/chess-bench.js.
//   COZYSHELVES_BOOKS="<library>|structured" node build/screenshot.js chess-snip-check
const fs = require('fs');
const path = require('path');
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, sleep, log, shot } = k;
  let pass = 0, fail = 0;
  const check = (name, ok, info = '') => { if (ok) pass++; else fail++; log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
  const libDir = (process.env.COZYSHELVES_BOOKS || '').split(';')[0].split('|')[0];
  const truth = JSON.parse(fs.readFileSync(path.join(libDir, 'chess-truth.json'), 'utf8'));
  await k.boot();
  const books = await page.evaluate(() => window.__app.state.library.books.map((b) => ({ id: b.id, t: b.title, rel: b.relPath, chess: b.isChess })));
  const find = (rel) => books.find((b) => (b.rel || '').replace(/\\/g, '/').endsWith(rel));
  const main = find(truth.pdf), learn = find(truth.learn.pdf);
  log('BOOKS ' + JSON.stringify({ main: main?.t, mainChess: main?.chess, learn: learn?.t, ebook: truth.epub ? find(truth.epub.file)?.t : null, ebookChess: truth.epub ? find(truth.epub.file)?.chess : null }));
  if (!main) { check('library', false, 'test PDF not in the library'); return; }

  const placement = (fen) => String(fen).split(' ')[0];
  const fenOnBoard = () => page.evaluate(() => document.querySelector('.rd-chess .chess-fen')?.value || '');
  async function openBook(b) {
    await k.closeAll();
    await page.evaluate(() => window.api.settings.set({ reader: { theme: 'white', themeChosen: true, columns: 2 } }));
    await k.open('reader', { id: b.id }, 1500);
    await page.waitForFunction(() => !document.querySelector('.rd-loading'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('.rd-chess:not(.hidden) .chess-board'), null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
  }
  async function showPage(index) {
    await page.evaluate((i) => document.querySelector('.rd-view').goTo(i), index);
    await page.waitForFunction((i) => [...document.querySelector('.rd-view').renderer.getContents()].some((c) => c.doc?.querySelector('#canvas > canvas')?.pageIndex === i && c.doc.querySelector('#canvas > canvas').imageRects), index, { timeout: 20000 }).catch(() => {});
    await page.mouse.move(5, 400);
    await sleep(600);
  }
  /** screen rectangle of a rectangle in PDF points on page `index` */
  const screenRect = (index, [x, y, w, hh]) => page.evaluate(([i, r, pw]) => {
    const doc = [...document.querySelector('.rd-view').renderer.getContents()].map((c) => c.doc).find((d) => d?.querySelector('#canvas > canvas')?.pageIndex === i);
    if (!doc) return null;
    const fr = doc.defaultView.frameElement.getBoundingClientRect();
    const z = fr.width / pw;
    return { x: fr.left + r[0] * z, y: fr.top + r[1] * z, w: r[2] * z, h: r[3] * z };
  }, [index, [x, y, w, hh], 432]);
  /** the user's way: D, drag a rectangle, wait for the card */
  async function snip(index, rect, name) {
    const sr = await screenRect(index, rect);
    if (!sr) return { error: 'page not shown' };
    return snipScreen(sr, name);
  }
  async function snipScreen(sr, name) {
    const before = await page.evaluate(() => document.querySelector('.chess-rec')?.dataset.serial || '');
    await page.keyboard.press('d');
    await page.waitForSelector('.rd-snip', { timeout: 5000 }).catch(() => {});
    await page.mouse.move(sr.x, sr.y);
    await page.mouse.down();
    await page.mouse.move(sr.x + sr.w / 2, sr.y + sr.h / 2, { steps: 4 });
    await page.mouse.move(sr.x + sr.w, sr.y + sr.h, { steps: 4 });
    if (name) await shot(name + '-drag');
    await page.mouse.up();
    const t0 = Date.now();
    await page.waitForFunction(() => !document.querySelector('.rd-snip'), null, { timeout: 60000 }).catch(() => {});
    const ms = Date.now() - t0;
    await sleep(400);
    void before;
    const st = await page.evaluate(() => ({
      card: !!document.querySelector('.chess-rec:not(.hidden)'), status: document.querySelector('.chess-rec-status')?.textContent || '',
      notice: document.querySelector('.rd-notice:not(.hidden)')?.textContent || '', fen: document.querySelector('.rd-chess .chess-fen')?.value || '',
      orientation: document.querySelector('.rd-chess .cg-wrap.orientation-black') ? 'black' : 'white', cells: document.querySelectorAll('.chess-fix-cell').length,
      unsure: document.querySelectorAll('.chess-fix-cell.unsure').length,
    }));
    return { ...st, ms };
  }
  const squareDiff = (a, b) => {
    const expand = (p) => p.split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d)));
    const A = expand(placement(a)), B = expand(placement(b));
    const out = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((A[r] || '')[c] !== (B[r] || '')[c]) out.push(`${'abcdefgh'[c]}${8 - r}:${(A[r] || '')[c]}→${(B[r] || '')[c]}`);
    return out;
  };

  // ---- the test PDF: every diagram, snipped like a user would ----------------------------------------------------
  await openBook(main);
  check('chess-pane', await page.evaluate(() => !!document.querySelector('.rd-chess:not(.hidden) .chess-snip-btn')), 'snip button in the chess pane of a chess book');
  // Esc cancels
  await showPage(truth.diagrams[0].page);
  const fenStart = await fenOnBoard();
  await page.keyboard.press('d');
  const opened = await page.waitForSelector('.rd-snip', { timeout: 4000 }).then(() => true).catch(() => false);
  await shot('cs-snip-overlay');
  await page.keyboard.press('Escape'); await sleep(300);
  const closed = await page.evaluate(() => !document.querySelector('.rd-snip'));
  check('esc-cancels', opened && closed && (await fenOnBoard()) === fenStart, `overlay ${opened} → closed ${closed}`);
  // the app's templates for the benchmark
  if (process.env.CHESS_DUMP) {
    const dump = await page.evaluate(async () => {
      const t = await window.__chessTemplates?.();
      if (!t) return null;
      const enc = (d) => { let s = ''; const u = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) u[i] = Math.max(0, Math.min(255, Math.round(d[i] * 255))); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
      return { sets: t.sets, boards: t.boards.map((b) => ({ set: b.set, style: b.style, w: b.img.w, h: b.img.h, d: enc(b.img.d), xs: b.xs, ys: b.ys, labels: b.labels })) };
    });
    if (dump) { fs.writeFileSync(process.env.CHESS_DUMP, JSON.stringify(dump)); log(`DUMP ${dump.boards.length} template boards (${dump.sets.join(', ')}) → ${process.env.CHESS_DUMP}`); }
    else log('DUMP not available');
  }
  let squaresOk = 0, squaresAll = 0;
  for (const [n, d] of truth.diagrams.entries()) {
    await showPage(d.page);
    const r = await snip(d.page, d.snip, n === 0 ? 'cs-d0' : null);
    await shot(`cs-diagram-${n}-${d.kind}`);
    // the captured snip itself, for build/chess-bench.js
    const url = await page.evaluate(() => window.__lastSnip?.canvas?.toDataURL('image/png'));
    if (url && process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, `snip-${n}.png`), Buffer.from(url.split(',')[1], 'base64'));
    const diff = squareDiff(d.fen, r.fen);
    squaresAll += 64; squaresOk += 64 - diff.length;
    const stm = (r.fen.split(' ')[1] || 'w') === d.stm;
    check(`diagram-${n}-${d.kind}-${d.set}-${d.style}${d.orientation === 'black' ? '-turned' : ''}`, r.card && diff.length <= (d.exact ? 0 : 2) && stm,
      `${64 - diff.length}/64 squares, to move ${r.fen.split(' ')[1]} (want ${d.stm}), board from ${r.orientation} (book ${d.orientation}), ${r.ms} ms, "${r.status}" ${diff.slice(0, 6).join(' ')} ${r.notice}`);
    if (d.kind === 'book-picture') await bookDiagram(d, r);
    if (n === 0) {
      const how = await page.evaluate(() => window.__lastRecognition || null);
      check('in-worker', how?.via === 'worker', `recognised in the ${how?.via}, ${how?.ms} ms`);
    }
  }
  log(`SQUARES test PDF: ${squaresOk}/${squaresAll} (${(100 * squaresOk / Math.max(1, squaresAll)).toFixed(1)} %)`);

  /** the book diagram: exact position, nothing marked unsure that is right, the texts in both languages */
  async function bookDiagram(d, r) {
    const card = () => page.evaluate(() => {
      const c = document.querySelector('.chess-rec');
      const t = (sel) => [...(c?.querySelectorAll(sel) || [])].map((e) => e.textContent.trim()).filter(Boolean);
      const side = document.querySelector('.rd-chess .chess-side');
      return {
        head: t('.chess-section-head h3')[0] || '', status: c?.querySelector('.chess-rec-status')?.textContent || '', buttons: t('button'), labels: t('label span'),
        entry: [...(side?.querySelectorAll('.chess-section-head h3') || [])].map((e) => e.textContent.trim()), placeholder: side?.querySelector('.chess-move-input')?.placeholder || '',
        playButtons: [...(side?.querySelectorAll('.chess-section .row .btn') || [])].map((e) => e.textContent.trim()).slice(0, 6), hint: side?.querySelector('.chess-hint')?.textContent || '',
        unsure: document.querySelectorAll('.chess-fix-cell.unsure').length, lang: document.documentElement.lang,
      };
    });
    const pct = +((r.status.match(/(\d+)\s*%/) || [])[1] || 0);
    const de = await card();
    await shot('cs-hatched-de');
    log('CARD de ' + JSON.stringify(de));
    check('book-diagram-confidence', pct >= 50 && de.unsure <= 2, `"${r.status.trim()}", ${de.unsure} squares marked unsure`);
    const german = de.head === 'Diagramm aus dem Buch' && /sicher/.test(de.status) && de.buttons.includes('Weiß am Zug') && de.buttons.includes('Schwarz am Zug')
      && de.labels.includes('Von Schwarz aus') && de.entry.includes('Züge aus dem Buch eingeben') && /Sf3/.test(de.placeholder) && /Strg/.test(de.hint);
    check('texts-german', german, `${de.head} | ${de.status} | ${de.buttons.join(', ')} | ${de.entry.join(', ')} | ${de.placeholder}`);
    // the app language switched while the card is open: everything follows at once
    await page.evaluate(() => window.api.settings.set({ language: 'en' }));
    await sleep(900);
    const en = await card();
    await shot('cs-hatched-en');
    log('CARD en ' + JSON.stringify(en));
    const english = en.head === 'Diagram from the book' && /sure/.test(en.status) && en.buttons.includes('White to move') && en.buttons.includes('Black to move')
      && en.labels.includes("From Black's side") && en.entry.includes('Enter moves from the book') && /Nf3/.test(en.placeholder) && /Ctrl/.test(en.hint);
    check('texts-english', english, `${en.head} | ${en.status} | ${en.buttons.join(', ')} | ${en.entry.join(', ')} | ${en.placeholder}`);
    await page.evaluate(() => window.api.settings.set({ language: 'de' }));
    await sleep(900);
    const back = await card();
    check('texts-german-again', back.head === 'Diagramm aus dem Buch' && back.entry.includes('Züge aus dem Buch eingeben'), `${back.head} | ${back.entry.join(', ')}`);
  }

  // ---- a correction: one square changed by hand, remembered for the book -----------------------------------------
  const d0 = truth.diagrams[0];
  await showPage(d0.page);
  await snip(d0.page, d0.snip);
  const before = await fenOnBoard();
  // an empty square of the diagram gets a white queen, through the overlay and the picker
  const target = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.chess-fix-cell')];
    const fen = document.querySelector('.rd-chess .chess-fen').value.split(' ')[0].split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d)));
    const black = !!document.querySelector('.rd-chess .cg-wrap.orientation-black');
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const file = black ? 7 - col : col, rank = black ? row : 7 - row;
      if (fen[7 - rank][file] === '.') return { idx: row * 8 + col, sq: 'abcdefgh'[file] + (rank + 1), n: cells.length };
    }
    return null;
  });
  if (target) {
    await page.evaluate((i) => document.querySelectorAll('.chess-fix-cell')[i].click(), target.idx); await sleep(300);
    await shot('cs-picker');
    await page.evaluate(() => document.querySelectorAll('.chess-fix-picker .chess-fix-piece')[1].click()); await sleep(600);
    const after = await fenOnBoard();
    const changed = squareDiff(before, after);
    const mem = await page.evaluate(async (id) => new Promise((res) => { const rq = indexedDB.open('lesesaal-diagrams'); rq.onsuccess = () => { const g = rq.result.transaction('books').objectStore('books').get(String(id)); g.onsuccess = () => res((g.result || []).length); g.onerror = () => res(-1); }; rq.onerror = () => res(-1); }), main.id);
    check('correction', changed.length === 1 && changed[0].startsWith(target.sq + ':.→Q'), `${target.sq}: ${changed.join(' ')}`);
    log(`MEMORY ${mem} templates for the book after one correction of an empty square (nothing to learn from an empty square)`);
    // a piece square corrected: remembered
    const occ = await page.evaluate(() => {
      const fen = document.querySelector('.rd-chess .chess-fen').value.split(' ')[0].split('/').map((r) => r.replace(/\d/g, (d) => '.'.repeat(+d)));
      const black = !!document.querySelector('.rd-chess .cg-wrap.orientation-black');
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        const file = black ? 7 - col : col, rank = black ? row : 7 - row;
        const ch = fen[7 - rank][file];
        if (ch !== '.' && ch.toLowerCase() !== 'k' && ch.toLowerCase() !== 'q') return { idx: row * 8 + col, sq: 'abcdefgh'[file] + (rank + 1), ch };
      }
      return null;
    });
    if (occ) {
      await page.evaluate((i) => document.querySelectorAll('.chess-fix-cell')[i].click(), occ.idx); await sleep(250);
      // the same piece as recognised: confirmed by hand, a template for the book
      const pick = 'KQRBNPkqrbnp'.indexOf(occ.ch);
      await page.evaluate((p) => document.querySelectorAll('.chess-fix-picker .chess-fix-piece')[p].click(), pick); await sleep(600);
      const mem2 = await page.evaluate(async (id) => new Promise((res) => { const rq = indexedDB.open('lesesaal-diagrams'); rq.onsuccess = () => { const g = rq.result.transaction('books').objectStore('books').get(String(id)); g.onsuccess = () => res((g.result || []).length); }; }), main.id);
      check('remembered', mem2 >= 1, `${mem2} templates for the book after confirming ${occ.ch} on ${occ.sq}`);
    }
  } else check('correction', false, 'no empty square found');

  // ---- learning: a piece set no template knows -------------------------------------------------------------------
  if (learn) {
    await openBook(learn);
    const results = [];
    for (const [n, d] of truth.learn.diagrams.entries()) {
      await showPage(d.page);
      const r = await snip(d.page, d.snip, null);
      const diff = squareDiff(d.fen, r.fen);
      // the same snip read once more without the corrections remembered for the book (the comparison)
      const plain = n ? await page.evaluate(async () => { try { return (await window.__recognizeShot(window.__lastSnip, { bookId: null })).res.placement; } catch { return null; } }) : null;
      results.push({ right: 64 - diff.length, plainRight: plain ? 64 - squareDiff(d.fen, plain).length : null });
      await shot(`cs-learn-${n}`);
      // correct every wrong square by hand, as a reader would
      let rounds = 0;
      for (;;) {
        const now = await fenOnBoard();
        const wrong = squareDiff(d.fen, now);
        if (!wrong.length || rounds++ > 40) break;
        const [sq, change] = wrong[0].split(':');
        const want = change.split('→')[0];
        const idx = await page.evaluate((s) => {
          const black = !!document.querySelector('.rd-chess .cg-wrap.orientation-black');
          const file = s.charCodeAt(0) - 97, rank = +s[1] - 1;
          const col = black ? 7 - file : file, row = black ? rank : 7 - rank;
          return row * 8 + col;
        }, sq);
        await page.evaluate((i) => document.querySelectorAll('.chess-fix-cell')[i]?.click(), idx); await sleep(150);
        if (want === '.') await page.evaluate(() => document.querySelector('.chess-fix-picker .chess-fix-empty')?.click());
        else await page.evaluate((p) => document.querySelectorAll('.chess-fix-picker .chess-fix-piece')[p]?.click(), 'KQRBNPkqrbnp'.indexOf(want));
        await sleep(350);
      }
      log(`LEARN diagram ${n}: ${64 - diff.length}/64 right at first${n ? ` (${results[n].plainRight}/64 without the book's corrections)` : ''}, corrected in ${rounds} clicks`);
    }
    // the corrections of the earlier diagrams must make the later ones better than the same snips read without them
    const later = results.slice(1).filter((x) => x.plainRight != null);
    const withMem = later.reduce((a, x) => a + 64 - x.right, 0), without = later.reduce((a, x) => a + 64 - x.plainRight, 0);
    check('learning', later.length >= 2 && withMem < without, `first ${results[0].right}/64; later diagrams ${withMem} wrong squares with the book's corrections, ${without} without (${later.map((x) => `${x.right}/${x.plainRight}`).join(', ')})`);
    await shot('cs-learn-last');
  }

  // ---- a chess e-book (EPUB): the diagram is a picture in the text, taken at its own resolution ------------------
  const ebook = truth.epub && find(truth.epub.file);
  if (truth.epub && !ebook) check('epub', false, 'the e-book is not in the library');
  if (ebook) {
    await openBook(ebook);
    for (const [n, d] of truth.epub.diagrams.entries()) {
      await page.evaluate((i) => document.querySelector('.rd-view').goTo(i), d.chapter - 1);
      await page.mouse.move(5, 400);
      // the picture of that chapter on screen (the frame may be scaled)
      const box = await page.waitForFunction(() => {
        for (const c of document.querySelector('.rd-view').renderer.getContents()) {
          const img = c.doc?.querySelector('.dia img');
          if (!img?.complete || !img.naturalWidth) continue;
          const frame = c.doc.defaultView.frameElement, fr = frame.getBoundingClientRect(), b = img.getBoundingClientRect();
          const sx = frame.offsetWidth ? fr.width / frame.offsetWidth : 1;
          const r = { x: fr.left + b.left * sx, y: fr.top + b.top * sx, w: b.width * sx, h: b.height * sx };
          if (r.w > 80 && r.x >= 0 && r.x + r.w <= innerWidth && r.y >= 0 && r.y + r.h <= innerHeight) return r;
        }
        return null;
      }, null, { timeout: 15000 }).then((hd) => hd.jsonValue()).catch(() => null);
      if (!box) { check(`epub-diagram-${n}`, false, 'picture not on screen'); continue; }
      await sleep(500);
      const m = 0.05 * box.w;
      const r = await snipScreen({ x: box.x - m, y: box.y - m, w: box.w + 2 * m, h: box.h + 2 * m }, n === 0 ? 'cs-epub' : null);
      await shot(`cs-epub-diagram-${n}`);
      const src = await page.evaluate(() => ({ source: window.__lastSnip?.source, w: window.__lastSnip?.width }));
      const diff = squareDiff(d.fen, r.fen);
      check(`epub-diagram-${n}-${d.set}-${d.style}${d.orientation === 'black' ? '-turned' : ''}`, r.card && diff.length <= 2 && src.source === 'image' && (r.fen.split(' ')[1] || 'w') === d.stm,
        `${64 - diff.length}/64 squares, to move ${r.fen.split(' ')[1]} (caption: ${d.stm}), board from ${r.orientation} (book ${d.orientation}), captured from the ${src.source} at ${src.w} px, ${r.ms} ms ${diff.slice(0, 6).join(' ')} ${r.notice}`);
    }
  }
  await k.closeAll();
  const errs = k.errors.filter((e) => !/Failed to load resource|sandboxing/.test(e));
  check('no-errors', !errs.length, JSON.stringify(errs.slice(0, 5)));
  log(`SUMMARY chess-snip-check: ${pass} passed, ${fail} failed`);
};
