// The card right of the crosshair while a book is under it (ui/hud.js #peek, styles/hud.css .peek-*). Since 0.7.2 the
// cover stands alone: no panel around it (the glass card with its border and padding read as a white frame), rounded
// corners and a soft shadow, the progress line and the "read" badge on the cover; the keys sit on a small translucent
// pill of their own, centred below the cover with a little gap; with the hints off nothing is below the cover. The
// same for the audiobook card (ui/audiobooks/ab-card.js shares the classes). Checked in the three themes, with
// pictures from a visitor's view of a shelf (a book pulled out, the card beside it).
//   COZYSHELVES_BOOKS="<library with covers, e.g. testbooks4>|structured" COZYSHELVES_USERDATA=<fresh dir> SHOT_DIR=<dir>
//   node build/screenshot.js peek-card-check
//   PC_SIZE=1600x900 (the window; a second picture is taken at 2560x1440, the size the user plays at)
//   PC_AUDIOBOOKS=<folder of test audiobooks> (made with build/testlib/gen_audiobooks.js when it is missing; 0 skips it)
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const [SW, SH] = (process.env.PC_SIZE || '1600x900').split('x').map(Number);
  const log = (k, v) => console.log(k + ' ' + JSON.stringify(v));
  let passed = 0, failed = 0;
  const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); if (ok) passed++; else failed++; };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push('pageerror: ' + e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|ERR_|net::|favicon|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  const waitFor = async (fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const userData = process.env.COZYSHELVES_USERDATA || '';
  const abLib = process.env.PC_AUDIOBOOKS === '0' ? null : path.resolve(process.env.PC_AUDIOBOOKS || (userData ? userData.replace(/[\\/]+$/, '') + '-audiobooks' : 'ab-testlib'));
  const size = async (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win?.setContentSize(w, h); return win?.getContentSize(); }, [w, h]);
  log('WINDOW', await size(SW, SH));

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(1500);
  }
  await sleep(8000);   // the delayed rebuild of the shelves after the scan
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });

  // helpers in the page: the world loop rests, frames are drawn by hand
  await page.evaluate(() => {
    const w = window.__app.world;
    const C = window.__pc = {
      frames(n = 1, dt = 0.05) { for (let i = 0; i < n; i++) { w.books.update(dt, w.camera); w.frame(); } },
      /** a shelf book with a cover image at eye height downstairs, in the middle of its row (the indexer's stand-in
       *  cards do not count; a book at the end of a row is hidden by the side of the case when seen from the side) */
      book() {
        const ok = (e) => !e.hidden && !e.bookcase.y && e.pos.y > 1.25 && e.pos.y < 1.75 && e.book.hasCover !== false && e.book.coverGenerated !== true;
        const mid = (e) => { const it = e.row?.items || []; const i = it.findIndex((x) => x.id === e.book.id); return it.length >= 5 && i >= 2 && i <= it.length - 3; };
        const all = [...w.books.entries.values()].filter(ok);
        return all.find(mid) || all[0] || null;
      },
      /** stand `dist` m in front of a book and `side` m along the shelf (less far when the ray does not reach it),
       *  the crosshair on its spine (the look ray takes it) */
      aim(e, side = 0.6, dist = 1.0) {
        const V = w.camera.position.constructor, right = new V(e.forward.z, 0, -e.forward.x);
        for (const s of [side, side / 2, 0]) {
          const p = e.pos.clone().addScaledVector(e.forward, dist).addScaledVector(right, -s);
          if (w.actions.seatedId) w.actions.leaveSeat();
          w.player.transition = null; w.player.setPose(p.x, p.z, 0, 0); w.player.update(0.016); w.camera.updateMatrixWorld();
          const d = e.pos.clone().addScaledVector(e.forward, e.d / 2 - 0.004).sub(w.camera.position).normalize();
          w.player.yaw = Math.atan2(-d.x, -d.z); w.player.pitch = Math.asin(d.y); w.player.update(0.016); w.camera.updateMatrixWorld();
          w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
          if (w.actions.target?.book?.id === e.book.id) return s;
        }
        return null;
      },
      /** the card has faded in (its CSS transition runs in real time, the world loop rests) */
      faded() { const p = document.querySelector('#book-peek'); return p.classList.contains('show') && getComputedStyle(p).opacity === '1'; },
      /** the pulled-out book is out, turned and widened (books.js HoverSlot) */
      bookOut(e) { const s = w.books.slots.find((x) => x.entry === e); return !!s && s.t >= 1 && s.dAsp === s.coverD && (s.kind === 'cover' || s.kind === 'typo'); },
      /** the card as it is seen: the panel, the cover, the pill of keys, and what else is below the cover */
      card() {
        const peek = document.querySelector('#book-peek'), card = peek.querySelector('.peek-card'), cover = peek.querySelector('.peek-cover');
        if (!card || !cover || !peek.classList.contains('show')) return { show: false };
        const cs = getComputedStyle(card), cv = getComputedStyle(cover), r = card.getBoundingClientRect(), c = cover.getBoundingClientRect();
        const keys = card.querySelector('.peek-keys'), ks = keys && getComputedStyle(keys), k = keys && keys.getBoundingClientRect();
        const alpha = (col) => { const m = /rgba?\(([^)]+)\)/.exec(col || ''); if (!m) return null; const p = m[1].split(',').map((v) => parseFloat(v)); return p.length > 3 ? p[3] : 1; };
        const below = [...card.children].filter((n) => n !== cover).map((n) => n.className);
        return {
          show: true, theme: document.documentElement.dataset.theme,
          panel: { bg: cs.backgroundColor, bgAlpha: alpha(cs.backgroundColor), border: parseFloat(cs.borderTopWidth) || 0, padding: parseFloat(cs.paddingTop) || 0, shadow: cs.boxShadow !== 'none' },
          cover: { radius: parseFloat(cv.borderRadius) || 0, shadow: cv.boxShadow !== 'none', left: Math.round(c.left), right: Math.round(c.right), top: Math.round(c.top), bottom: Math.round(c.bottom), cx: +(c.left + c.width / 2).toFixed(1), h: Math.round(c.height), frac: +(c.height / innerHeight).toFixed(3), progress: !!cover.querySelector('.peek-progress'), badge: !!cover.querySelector('.peek-read'), img: !!cover.querySelector('img, canvas, .peek-fallback') },
          keys: keys ? { text: keys.textContent.replace(/\s+/g, ' ').trim(), bg: ks.backgroundColor, bgAlpha: alpha(ks.backgroundColor), radius: parseFloat(ks.borderRadius) || 0, border: parseFloat(ks.borderTopWidth) || 0, shadow: ks.boxShadow !== 'none', color: ks.color, cx: +(k.left + k.width / 2).toFixed(1), top: Math.round(k.top), gap: +(k.top - c.bottom).toFixed(1), w: Math.round(k.width), h: Math.round(k.height), kbd: keys.querySelectorAll('kbd').length } : null,
          below, cardBottom: Math.round(r.bottom), cardLeft: Math.round(r.left), vw: innerWidth, vh: innerHeight,
        };
      },
    };
    void C;
  });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const setTheme = async (t) => { await cc((t) => window.api.settings.set({ ui: { theme: t } }), t); const ok = await waitFor((t) => document.documentElement.dataset.theme === t, t); await cc(() => window.__pc.frames(2)); return ok; };
  const theme0 = await cc(() => document.documentElement.dataset.theme);
  // a picture once the card has faded in (never a fixed time)
  const picture = async (name) => { await waitFor(() => window.__pc.faded(), null, 3000); await cc(() => window.__app.world.frame()); await shot(name); };

  // ---- a book with a cover, pulled out, the card beside it -----------------------------------------------------------
  const target = await cc(() => { const e = window.__pc.book(); if (!e) return null; window.__pcBook = e; return { id: e.book.id, title: e.book.title, side: window.__pc.aim(e) }; });
  log('BOOK', target);
  if (!target) { check('a shelf book with a cover image at eye height', false); console.log(`PEEK-CARD-CHECK failed=1 passed=0`); return; }
  check('the crosshair rests on the book (seen from the side)', target.side != null, target);
  // the book comes out and the card goes in once the cover is decoded: wait for both, never a fixed time
  let shown = false;
  for (let i = 0; i < 200 && !shown; i++) { shown = await cc(() => { window.__pc.frames(1); return window.__pc.bookOut(window.__pcBook) && document.querySelector('#book-peek.show .peek-card .peek-cover'); }); if (!shown) await sleep(30); }
  const results = {};
  for (const theme of ['light', 'sepia', 'dark']) {
    const ok = await setTheme(theme);
    await waitFor(() => window.__pc.faded(), null, 3000);
    const c = await cc(() => window.__pc.card());
    results[theme] = c;
    log('CARD ' + theme, c);
    check(`${theme}: the card shows the cover and the keys`, ok && c.show && c.cover.img && c.keys && c.keys.kbd >= 3, c.keys);
    check(`${theme}: no panel around the cover (no background, border, padding or shadow on the card)`, c.show && (c.panel.bgAlpha === 0 || c.panel.bgAlpha == null) && c.panel.border === 0 && c.panel.padding === 0 && !c.panel.shadow, c.panel);
    check(`${theme}: the cover has rounded corners and a soft shadow, in its own proportions (two fifths of the height)`, c.show && c.cover.radius >= 8 && c.cover.shadow && c.cover.frac >= 0.38 && c.cover.frac <= 0.46, c.cover);
    check(`${theme}: the keys sit on a translucent pill (round ends, a hairline, a shadow), centred under the cover with an 8 to 18 px gap`, c.show && c.keys.bgAlpha > 0.5 && c.keys.bgAlpha < 1 && c.keys.radius >= 100 && c.keys.border >= 1 && c.keys.shadow && Math.abs(c.keys.cx - c.cover.cx) < 2 && c.keys.gap >= 8 && c.keys.gap <= 18 && c.keys.h < 70, c.keys);
    await picture(`peek-card-${theme}`);
  }
  check('the pill follows the theme (its ground differs between light and dark)', results.light.keys && results.dark.keys && results.light.keys.bg !== results.dark.keys.bg && results.light.keys.color !== results.dark.keys.color, { light: results.light.keys?.bg, dark: results.dark.keys?.bg });
  await setTheme('sepia');

  // ---- how far you have read and the "read" badge stay on the cover -------------------------------------------------
  const marks = await cc(() => {
    const e = window.__pcBook, b = e.book;
    const keep = { progress: b.progress, finished: b.finished };
    b.progress = 0.42; b.finished = true;
    const w = window.__app.world; w.opts.onTarget(w.actions.target);
    return keep;
  });
  const marked = await (async () => { for (let i = 0; i < 100; i++) { const c = await cc(() => window.__pc.card()); if (c.show && c.cover.progress && c.cover.badge) return c; await sleep(30); } return cc(() => window.__pc.card()); })();
  log('MARKS', marked.cover);
  check('the progress line and the "read" badge sit on the cover, nothing else below it', marked.show && marked.cover.progress && marked.cover.badge && marked.below.length === 1 && /peek-keys/.test(marked.below[0]), { cover: marked.cover, below: marked.below });
  await picture('peek-card-read');
  await cc((keep) => { const b = window.__pcBook.book; b.progress = keep.progress; b.finished = keep.finished; const w = window.__app.world; w.opts.onTarget(w.actions.target); }, marks);

  // ---- hints off: nothing below the cover ---------------------------------------------------------------------------
  await cc(() => window.__app.ctx.api.settings.set({ hints: false }));
  await waitFor(() => window.__app.state.settings?.hints === false);
  await cc(() => { const w = window.__app.world; w.opts.onTarget(w.actions.target); window.__pc.frames(2); });
  const noHints = await (async () => { for (let i = 0; i < 100; i++) { const c = await cc(() => window.__pc.card()); if (c.show && !c.keys) return c; await sleep(30); } return cc(() => window.__pc.card()); })();
  log('NOHINTS', { below: noHints.below, cardBottom: noHints.cardBottom, coverBottom: noHints.cover?.bottom });
  check('hints off: the cover alone, nothing below it', noHints.show && !noHints.keys && noHints.below.length === 0 && noHints.cardBottom - noHints.cover.bottom <= 1, { below: noHints.below, cardBottom: noHints.cardBottom, cover: noHints.cover?.bottom });
  await picture('peek-card-nohints');
  await cc(() => window.__app.ctx.api.settings.set({ hints: true }));
  await waitFor(() => window.__app.state.settings?.hints !== false);
  await cc(() => { const w = window.__app.world; w.opts.onTarget(w.actions.target); window.__pc.frames(2); });

  // ---- the size the user plays at --------------------------------------------------------------------------------------
  log('WINDOW', await size(2560, 1440));
  await sleep(400);
  await cc(() => { window.__pc.aim(window.__pcBook); });
  for (let i = 0; i < 200; i++) { const ok = await cc(() => { window.__pc.frames(1); return window.__pc.bookOut(window.__pcBook) && !!document.querySelector('#book-peek.show .peek-card .peek-keys'); }); if (ok) break; await sleep(30); }
  const big = await cc(() => window.__pc.card());
  log('CARD 2560', big);
  check('at 2560 × 1440: the card still at 60 % of the width, the pill centred under the cover', big.show && big.cardLeft / big.vw >= 0.58 && big.cardLeft / big.vw <= 0.62 && big.keys && Math.abs(big.keys.cx - big.cover.cx) < 2 && big.keys.gap >= 8 && big.keys.gap <= 18, { left: big.cardLeft, vw: big.vw, keys: big.keys });
  await picture('peek-card-2560');
  log('WINDOW', await size(SW, SH));
  await sleep(300);

  // ---- the audiobook card: the same look -----------------------------------------------------------------------------
  if (abLib) {
    if (!fs.existsSync(abLib)) { require('../testlib/gen_audiobooks').generate(abLib, { extra: 22 }); console.log('[pc] test audiobooks written to', abLib); }
    await app.evaluate(({ dialog }, dir) => { dialog.__pcOrig = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, abLib);
    await cc(() => window.__app.openPanel('settings', { section: 'audiobooks' }));
    const btn = await waitFor(() => [...document.querySelectorAll('.settings-panel button')].some((b) => /Hörbuchordner hinzufügen|Add an audiobook folder/.test(b.textContent)));
    if (btn) await cc(() => [...document.querySelectorAll('.settings-panel button')].find((b) => /Hörbuchordner hinzufügen|Add an audiobook folder/.test(b.textContent)).click());
    const found = btn && await waitFor(() => /\d+ Hörbücher|\d+ audiobooks/.test(document.querySelector('.ab-set-status')?.textContent || ''), null, 90000);
    await app.evaluate(({ dialog }) => { if (dialog.__pcOrig) dialog.showOpenDialog = dialog.__pcOrig; });
    await cc(() => window.__app.closeAllPanels());
    await waitFor(() => !document.querySelector('.panel-layer:not(.closing)'), null, 5000);
    // the boxes are laid out once the folder is read: wait for a box with a book, then look at it from 1 m
    const box = found && await waitFor(() => { const s = window.__app.world.audiobooks; window.__pc.frames(1); return !!s?.slots?.some((x) => x.book && x.matrix); }, null, 30000);
    const ab = box ? await cc(() => {
      const w = window.__app.world, s = w.audiobooks, i = s.slots.findIndex((x) => x.book && x.matrix), v = s.viewOf(i, 1.0);
      if (w.actions.seatedId) w.actions.leaveSeat();
      w.player.transition = null; w.player.setPose(v.x, v.z, v.yaw, v.pitch); w.player.update(0.016); w.camera.updateMatrixWorld();
      w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
      return { i, t: w.actions.target?.type };
    }) : null;
    log('AUDIOBOOK', { found, box, ab });
    // wait for the audiobook's own card: the card of the book looked at before still shows with its keys for a moment
    // (with faster frames since 0.9 the loop ended on that card)
    let abCard = { show: false };
    const ready = (c) => c.show && c.keys && c.ab;
    for (let i = 0; i < 200 && !ready(abCard); i++) { abCard = await cc(() => { window.__pc.frames(1); const c = window.__pc.card(); c.ab = !!document.querySelector('#book-peek .peek-card.ab-peek'); return c; }); if (!ready(abCard)) await sleep(30); }
    log('CARD audiobook', abCard);
    check('the audiobook card matches: no panel, the square cover alone, the keys on a pill centred below it', ab?.t === 'audiobook' && abCard.show && abCard.ab && abCard.panel.border === 0 && abCard.panel.padding === 0 && !abCard.panel.shadow && abCard.cover.shadow && abCard.keys && abCard.keys.bgAlpha > 0.5 && abCard.keys.bgAlpha < 1 && abCard.keys.radius >= 100 && Math.abs(abCard.keys.cx - abCard.cover.cx) < 2 && abCard.keys.gap >= 8 && abCard.keys.gap <= 18, { ab, panel: abCard.panel, cover: abCard.cover, keys: abCard.keys });
    await picture('peek-card-audiobook');
  } else console.log('SKIP audiobook card (PC_AUDIOBOOKS=0)');

  await setTheme(theme0 || 'sepia');
  check('no errors in the page', errors.length === 0, errors.slice(0, 5));
  console.log(`PEEK-CARD-CHECK ${failed ? 'FAILED' : 'OK'} passed=${passed} failed=${failed}`);
};
