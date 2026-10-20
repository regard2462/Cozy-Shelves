// HUD and media of 0.6 (the card of 0.7: two fifths of the window high, its left edge at 60 % of the width):
//   1. the book card: two fifths of the window high, its own proportions, sharp (the cached cover in full
//      resolution, the title card drawn at the size it shows), decoded before it shows, never over the crosshair,
//      clear of the clock and of the mini player, also in a small window
//   2. the keys: the card's row, the basket at the bottom left (empty and with books), the note after taking a book,
//      B opens the basket
//   3. the label below the crosshair for everything but books (every kind of target, seats, a picture, the cat, the
//      screen), none for books; the key part follows "Hinweise einblenden"; Hell, Sepia and Dunkel; no layout jank
//   4. every action of the mini player has a key (film: K J L P F O X V, podcast: K J L O X) and shows its key cap
//   5. the video quality (0.7: picture sizes): the setting "Bevorzugte Qualität" (default Automatisch), the quick
//      switch lists the real sizes and keeps the position, a new setting applies to the running film (the closest
//      size), the download menu marks the closest size, HLS levels (needs the network, HQ_NET=0 skips it), the
//      quality of 0.5 kept in localStorage becomes the setting (as the height it stands for)
//   6. the background music pauses while a film or a podcast plays and comes back afterwards; the setting
//      (audio.pauseForMedia) turns it off; a record chosen by hand plays anyway
// Offline media as in media-focus-check (a canvas test pattern as film, a silent WAV as podcast). Runs muted and
// hidden like every harness script.
//   node build/screenshot.js hud-check   (COZYSHELVES_BOOKS with real covers and books without, e.g. testbooks4)
module.exports = async ({ app, page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = async (fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const net = process.env.HQ_NET !== '0';
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win.setContentSize(w, h); }, [w, h]);

  // ---- boot -------------------------------------------------------------------------------------------------------
  await setSize(1600, 960);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const defaults = await cc(async () => { const s = await window.api.settings.get(); return { quality: s.mediathek?.quality, pause: s.audio?.pauseForMedia }; });
  check('defaults: video quality "auto", music pauses for films and podcasts', defaults.quality === 'auto' && defaults.pause === true, defaults);
  await cc(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await cc(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '' }; });
    if (st.n > 0 && !st.active && !st.hud && st.idx === st.n) break;
    await sleep(2000);
  }
  await sleep(3000);
  await cc(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  await sleep(600);

  // ---- helpers inside the page ---------------------------------------------------------------------------------------
  await cc(() => {
    const w = window.__app.world, p = w.player;
    window.__hc = {
      aim(x, z, tx, ty, tz) {
        if (w.actions.seatedId || p.seated) w.actions.leaveSeat();
        p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - 1.62, Math.hypot(tx - x, tz - z)));
        return this.look();
      },
      look() { p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); const t = w.actions.target; return t ? { type: t.type, kind: t.kind || null, book: t.book?.id || t.id || null, near: t.near ?? null } : null; },
      key(code, key) { document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true })); document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true })); },
      panels() { return [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel); },
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      /** the label below the crosshair as it is seen: shown or not, its texts, where it sits */
      label() {
        const el = document.querySelector('#look-label'), cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const keys = el.querySelector('.ll-keys');
        return { show: el.classList.contains('show') && cs.visibility !== 'hidden' && +cs.opacity > 0.9, name: el.querySelector('.ll-name').textContent, key: keys.hidden ? '' : keys.querySelector('kbd').textContent + ' ' + keys.querySelector('.ll-what').textContent, cx: Math.round(r.left + r.width / 2 - innerWidth / 2), top: Math.round(r.top - innerHeight / 2), color: cs.color, bg: cs.backgroundColor };
      },
      /** look at nothing (the hall's ceiling): no target in the world and in the HUD; a book still on its way back
       *  to the shelf from a frame drawn for a picture settles (the world loop rests in this check) */
      away() { const t = this.aim(-0.8, 1.4, -0.8, 5.0, 1.3); for (let i = 0; i < 40; i++) w.books.update(0.05, w.camera); return t; },
      /** the book card on the right */
      card() {
        const peek = document.querySelector('#book-peek'), card = peek.querySelector('.peek-card'), cover = peek.querySelector('.peek-cover');
        if (!card || !peek.classList.contains('show')) return { show: false };
        const r = card.getBoundingClientRect(), c = cover.getBoundingClientRect();
        const img = cover.querySelector('img'), canvas = cover.querySelector('canvas');
        return {
          show: true, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
          coverW: Math.round(c.width), coverH: Math.round(c.height), frac: +(c.height / innerHeight).toFixed(3), ratio: +(c.width / c.height).toFixed(3),
          img: img ? { complete: img.complete, nw: img.naturalWidth, nh: img.naturalHeight, ratio: +(img.naturalWidth / img.naturalHeight).toFixed(3) } : null,
          canvas: canvas ? { w: canvas.width, h: canvas.height } : null,
          keys: [...peek.querySelectorAll('.peek-keys > span')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
          dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
        };
      },
      /** a shelf book at eye height: with a real cover image, or with only a title card */
      book(real) {
        const ok = (e) => !e.hidden && e.pos.y > 1.0 && e.pos.y < 1.8 && (real ? e.book.hasCover !== false && !e.book.coverGenerated : e.book.coverGenerated === true);
        return [...w.books.entries.values()].find(ok) || null;
      },
      /** stand in front of a shelf book and look at it */
      aimBook(e) { this.away(); w.actions.goToBook(e.book.id); return this.look(); },
    };
  });

  // ================================================================= 1. the book card ===============================================
  const cardOf = async (real) => cc(async (real) => {
    const c = window.__hc, e = c.book(real);
    if (!e) return { missing: true };
    // watch the moment the card goes in: its picture must be decoded by then
    let atInsert = null;
    const mo = new MutationObserver(() => { const img = document.querySelector('#book-peek .peek-card img'); if (img && !atInsert) atInsert = { complete: img.complete, nw: img.naturalWidth }; });
    mo.observe(document.querySelector('#book-peek'), { childList: true });
    const t = c.aimBook(e);
    await c.wait(500);
    mo.disconnect();
    return { t, title: e.book.title, card: c.card(), atInsert, label: c.label() };
  }, real);
  const real = await cardOf(true);
  console.log('CARD real ' + JSON.stringify(real));
  // 0.5 showed a cover of 240 × 360 px, whatever the size of the window
  // 0.5 showed a cover of 240 × 360 px, 0.6 two thirds of the window height; 0.7 two fifths, nearer the middle
  check('a book with a cover: 38 to 46 % of the window high, its left edge at 58 to 62 % of the width, larger than the cover of 0.5', !real.missing && real.card.show && real.card.frac >= 0.38 && real.card.frac <= 0.46 && real.card.left / real.card.vw >= 0.58 && real.card.left / real.card.vw <= 0.62 && real.card.coverW * real.card.coverH >= 240 * 360, real.card);
  check('the cover is sharp: the full cached image (at least the shown size in device pixels or the cache height of 900 px)', real.card.img && (real.card.img.nh >= real.card.coverH * real.card.dpr * 0.95 || real.card.img.nh >= 880), real.card.img);
  check('the card takes the proportions of the cover (no cropping)', real.card.img && Math.abs(real.card.ratio - Math.min(0.86, Math.max(0.5, real.card.img.ratio))) < 0.02, { box: real.card.ratio, image: real.card.img?.ratio });
  check('the picture is decoded before the card shows', real.atInsert && real.atInsert.complete && real.atInsert.nw > 0, real.atInsert);
  check('the card stays right of the crosshair and below the clock', real.card.left > real.card.vw / 2 + 40 && real.card.top > 90, { left: real.card.left, half: real.card.vw / 2, top: real.card.top });
  // (0.7: a fourth key follows, "C Als gelesen markieren", ui/shelf-info.js)
  check('the card has the keys "E In den Korb · R Lesen · F Info" (then C Als gelesen markieren)', real.card.keys.slice(0, 3).join(' · ') === 'E In den Korb · R Lesen · F Info' && /^C Als (un)?gelesen markieren$/.test(real.card.keys[3] || ''), real.card.keys);
  check('a book has no label below the crosshair', !real.label.show, real.label);
  await cc(() => window.__app.world.frame());
  await shot('hud-01-card-cover');
  const typo = await cardOf(false);
  console.log('CARD title card ' + JSON.stringify(typo));
  if (typo.missing) console.log('SKIP title card: every book of this library has a cover image');
  else {
    check('a book without a cover image: the title card is drawn as large as it shows (canvas, sharp)', typo.card.show && typo.card.canvas && typo.card.canvas.h >= typo.card.coverH * typo.card.dpr * 0.95 && typo.card.frac >= 0.36, typo.card);
    await cc(() => window.__app.world.frame());
    await shot('hud-02-card-title');
  }
  // the costs of a new card: building it (the title card is drawn on the spot) and the style and layout pass after it
  const cost = await cc(async () => {
    const hud = window.__app.ctx && window.__app.world.opts, w = window.__app.world;
    const entries = [...w.books.entries.values()].filter((e) => !e.hidden).slice(0, 40);
    const times = [];
    for (const e of entries) {
      const t = { type: 'book', entry: e, book: e.book, coverUrl: e.book.coverGenerated || e.book.hasCover === false ? null : w.opts.coverUrl(e.book.id) };
      const t0 = performance.now();
      hud.onTarget(t);
      document.querySelector('#book-peek').getBoundingClientRect();
      times.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 60));
    }
    hud.onTarget(null);
    times.sort((a, b) => a - b);
    return { n: times.length, p50: +times[Math.floor(times.length / 2)].toFixed(2), max: +times[times.length - 1].toFixed(2) };
  });
  check('building a card costs under 8 ms (median under 3 ms)', cost.max < 8 && cost.p50 < 3, cost);

  // a small window: the card still keeps right of the crosshair
  await setSize(1024, 640);
  await sleep(900);
  const small = await cc(async () => { const c = window.__hc, e = c.book(true) || c.book(false); c.away(); c.aimBook(e); await c.wait(500); return c.card(); });
  check('small window (1024 × 640): the card fits, right of the crosshair and below the clock', small.show && small.left > small.vw / 2 + 30 && small.top > 80 && small.bottom < small.vh - 10, small);
  await cc(() => window.__app.world.frame());
  await shot('hud-03-card-small-window');
  await setSize(800, 1000);
  await sleep(900);
  const tall = await cc(async () => { const c = window.__hc, e = c.book(true) || c.book(false); c.away(); c.aimBook(e); await c.wait(500); return c.card(); });
  check('narrow tall window (800 × 1000): the card shrinks to the space right of the crosshair', tall.show && tall.left > tall.vw / 2 + 30, tall);
  await setSize(1600, 960);
  await sleep(900);

  // ================================================================= 2. keys: basket, note, B ======================================
  // (a book a former run left in the basket goes back first)
  await cc(() => { const a = window.__app.world.actions; if (a.basket.length) { a.returnAll(); for (let i = 0; i < 40; i++) a.update(0.05); } });
  await sleep(800);
  const basket0 = await cc(() => { const b = document.querySelector('#basket-hud'); return { count: b.querySelector('.count')?.textContent, key: b.querySelector('.bk-key')?.textContent.replace(/\s+/g, ' ').trim(), kbd: b.querySelector('.bk-key kbd')?.textContent, covers: b.querySelectorAll('img').length }; });
  check('empty basket: "Korb leer" and the key "B Korb öffnen"', basket0.count === 'Korb leer' && basket0.kbd === 'B' && basket0.key === 'B Korb öffnen' && basket0.covers === 0, basket0);
  const took = await cc(async () => {
    const c = window.__hc, e = c.book(true) || c.book(false);
    c.aimBook(e);
    c.key('KeyE', 'e');
    await c.wait(400);
    const toast = [...document.querySelectorAll('#toasts .toast')].pop();
    const b = document.querySelector('#basket-hud');
    return { title: e.book.title, toast: toast?.textContent || '', toastKbd: toast?.querySelector('kbd')?.textContent || '', count: b.querySelector('.count')?.textContent, covers: b.querySelectorAll('img').length, key: b.querySelector('.bk-key')?.textContent.replace(/\s+/g, ' ').trim() };
  });
  check('E on a book: the note says it is in the basket and that B opens the basket', /liegt im Korb\. B öffnet den Korb\./.test(took.toast) && took.toastKbd === 'B', took);
  check('the basket shows the cover, "1 Buch im Korb" and "B Korb öffnen"', took.count === '1 Buch im Korb' && took.covers === 1 && took.key === 'B Korb öffnen', took);
  await cc(() => { for (let i = 0; i < 40; i++) window.__app.world.actions.update(0.05); window.__app.world.frame(); });
  await shot('hud-04-basket-note');
  await cc(() => window.__hc.key('KeyB', 'b'));
  await sleep(900);
  const bPanels = await cc(() => window.__hc.panels());
  check('B opens the basket', bPanels.includes('basket'), bPanels);
  await cc(() => window.__app.closeAllPanels()); await sleep(700);

  // ================================================================= 3. labels ======================================================
  // every kind of target in the layout, every kind of seat, a picture, the cat and the screen, given to the HUD
  const table = await cc(async () => {
    const w = window.__app.world, hud = w.opts, c = window.__hc, out = {};
    const kinds = [...new Set(w.layout.placements.filter((p) => p.meta?.interact).map((p) => p.meta.interact))];
    for (const kind of kinds) { hud.onTarget({ type: 'interact', kind, label: w.layout.placements.find((p) => p.meta?.interact === kind).meta.label }); await c.wait(160); out[kind] = c.label(); }
    for (const s of new Map([...w.seats.values()].map((s) => [s.kind, s])).values()) { hud.onTarget({ type: 'seat', seat: s, near: true }); await c.wait(160); out['seat:' + s.kind] = c.label(); }
    hud.onTarget({ type: 'painting', slot: 1 }); await c.wait(160); out.painting = c.label();
    hud.onTarget({ type: 'interact', kind: 'cat', label: { de: 'Katze', en: 'Cat' } }); await c.wait(160); out.cat = c.label();
    hud.onTarget({ type: 'interact', kind: 'screen' }); await c.wait(160); out.screen = c.label();
    hud.onTarget({ type: 'interact', kind: 'something-new', label: { de: 'Neues Ding', en: 'New thing' } }); await c.wait(160); out.unknown = c.label();
    hud.onTarget({ type: 'seat', seat: [...w.seats.values()][0], near: false }); await c.wait(200); out.seatFar = c.label();
    const e = [...w.books.entries.values()].find((x) => !x.hidden);
    hud.onTarget({ type: 'book', entry: e, book: e.book }); await c.wait(200); out.book = c.label();
    hud.onTarget({ type: 'tablebook', id: e.book.id, book: e.book }); await c.wait(200); out.tablebook = c.label();
    hud.onTarget(null); await c.wait(200); out.nothing = c.label();
    return out;
  });
  console.log('LABELS ' + JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, v.show ? v.name + ' · ' + v.key : '-']))));
  const named = Object.entries(table).filter(([k]) => !['seatFar', 'book', 'tablebook', 'nothing'].includes(k));
  check('every kind of target, seat, the picture, the cat and the screen has a label with name and key E', named.every(([, v]) => v.show && v.name && /^E\s+\S/.test(v.key)), named.filter(([, v]) => !(v.show && v.name && /^E\s+\S/.test(v.key))));
  const expect = { computer: 'Computer', records: 'Plattenspieler', podcasts: 'Radio', chess: 'Schachbrett', mediathek: 'Beamer', worldmap: 'Weltkarte', news: 'Zeitungsständer', wiki: 'Lexikon', cat: 'Katze', screen: 'Leinwand', 'seat:armchair': 'Sessel', 'seat:sofa': 'Sofa', 'seat:chair': 'Stuhl', painting: 'Bild', unknown: 'Neues Ding' };
  const wrong = Object.entries(expect).filter(([k, n]) => table[k] && table[k].name !== n).map(([k, n]) => [k, n, table[k].name]);
  check('the labels name the things (Katze, Schachbrett, Computer, Sessel, Leinwand …)', wrong.length === 0 && table.cat.key === 'E Streicheln' && table['seat:armchair'].key === 'E Hinsetzen', { wrong, cat: table.cat, armchair: table['seat:armchair'] });
  check('no label for books (shelf, table), for a seat out of reach and for nothing', !table.book.show && !table.tablebook.show && !table.seatFar.show && !table.nothing.show, { book: table.book.show, tablebook: table.tablebook.show, seatFar: table.seatFar.show, nothing: table.nothing.show });
  check('the label sits centred just below the crosshair', Math.abs(table.cat.cx) <= 2 && table.cat.top >= 12 && table.cat.top <= 40, { cx: table.cat.cx, top: table.cat.top });

  // the real thing: aimed through the look ray
  const aimed = await cc(async () => {
    const c = window.__hc, w = window.__app.world, out = {};
    const pl = (kind) => w.layout.placements.find((x) => x.kind === kind);
    const probe = async (name, fn) => { const t = fn(); await c.wait(220); out[name] = { t, label: c.label() }; };
    await probe('computer', () => { const q = pl('computer'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); });
    await probe('chess', () => { const q = pl('chessboardprop'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.72, q.z); });
    await probe('records', () => { const q = pl('recordplayer'); return c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.85, q.z); });
    // (the second fireside chair: the cat never sleeps there)
    await probe('armchair', () => { const s = w.seats.get('fireplace2'), o = s.obj.position; return c.aim(s.standPos.x, s.standPos.z, o.x, 0.55, o.z); });
    const cat = w.cat;
    if (cat && cat.group.visible) {
      await probe('cat', () => {
        cat.goTo(0, true); cat.nextMove = 1e9; w.frame(); cat.group.updateMatrixWorld(true);
        const pc = cat.group.localToWorld(cat.pick.position.clone());
        const s = cat.spots[cat.spot], d = s.landing.clone().sub(s.position).setY(0).normalize();
        const o = cat.group.position.clone().addScaledVector(d, 1.1);
        return c.aim(o.x, o.z, pc.x, pc.y, pc.z);
      });
    }
    return out;
  });
  for (const [name, r] of Object.entries(aimed)) check(`aimed at the ${name}: ring target and label "${r.label.name} · ${r.label.key}"`, r.t && r.label.show && r.label.name && /^E /.test(r.label.key), r);
  await cc(() => { const c = window.__hc, w = window.__app.world, q = w.layout.placements.find((x) => x.kind === 'chessboardprop'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.72, q.z); w.frame(); });
  await sleep(250);
  await shot('hud-05-label-chess');

  // the key part follows "Hinweise einblenden"
  await cc(() => window.__app.ctx.api.settings.set({ hints: false }));
  await sleep(700);
  const noHints = await cc(async () => { const c = window.__hc, w = window.__app.world, q = w.layout.placements.find((x) => x.kind === 'computer'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z); await c.wait(250); const l = c.label(); const e = c.book(true) || c.book(false); c.aimBook(e); await c.wait(500); return { label: l, card: c.card() }; });
  await cc(() => window.__app.ctx.api.settings.set({ hints: true }));
  await sleep(700);
  check('hints off: the label shows the name only, the card no key row', noHints.label.show && noHints.label.name === 'Computer' && noHints.label.key === '' && noHints.card.show && noHints.card.keys.length === 0, noHints);

  // English
  await cc(() => window.__app.ctx.api.settings.set({ language: 'en' }));
  await sleep(900);
  const english = await cc(async () => {
    const c = window.__hc, w = window.__app.world, q = w.layout.placements.find((x) => x.kind === 'chessboardprop');
    c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.72, q.z); await c.wait(250);
    const label = c.label(); const e = c.book(true) || c.book(false); c.aimBook(e); await c.wait(500);
    return { label, card: c.card(), basket: document.querySelector('#basket-hud .bk-text')?.textContent.replace(/\s+/g, ' ').trim() };
  });
  await cc(() => window.__app.world.frame());
  await shot('hud-05b-english');
  await cc(() => window.__app.ctx.api.settings.set({ language: 'de' }));
  await sleep(900);
  check('in English: "Chessboard · E Play chess", the card "E Into the basket · R Read · F Info", the basket "B Open the basket"', english.label.name === 'Chessboard' && english.label.key === 'E Play chess' && english.card.keys.slice(0, 3).join(' · ') === 'E Into the basket · R Read · F Info' && /B Open the basket/.test(english.basket), english);

  // Hell, Sepia, Dunkel: the label and the card in the colours of the theme, readable
  const lum = (rgb) => { const v = rgb.match(/[\d.]+/g).slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const themes = {};
  for (const theme of ['light', 'sepia', 'dark']) {
    await cc((t) => window.__app.ctx.api.settings.set({ ui: { theme: t } }), theme);
    await sleep(800);
    const r = await cc(async () => { const c = window.__hc, w = window.__app.world, q = w.layout.placements.find((x) => x.kind === 'recordplayer'); c.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 0.85, q.z); await c.wait(250); w.frame(); return { label: c.label(), theme: document.documentElement.dataset.theme }; });
    const L1 = lum(r.label.color), L2 = lum(r.label.bg);
    themes[theme] = { theme: r.theme, color: r.label.color, bg: r.label.bg, contrast: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(1) };
    await shot('hud-06-label-' + theme);
    if (theme === 'dark') { await cc(async () => { const c = window.__hc, e = c.book(true) || c.book(false); c.aimBook(e); await c.wait(500); window.__app.world.frame(); }); await shot('hud-07-card-dark'); }
  }
  await cc(() => window.__app.ctx.api.settings.set({ ui: { theme: 'sepia' } }));
  check('the label follows Hell, Sepia and Dunkel and stays readable (contrast at least 7:1)', Object.entries(themes).every(([k, v]) => v.theme === k && v.contrast >= 7) && new Set(Object.values(themes).map((v) => v.bg)).size === 3, themes);

  // no layout jank: a new label changes nothing else in the HUD, and it costs little
  const jank = await cc(async () => {
    const w = window.__app.world, hud = w.opts, c = window.__hc;
    const rects = () => ['#basket-hud', '#hud-top-right', '#crosshair', '#pointer-hint', '#scan-status'].map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',') : ''; }).join('|');
    const before = rects();
    const targets = [{ type: 'interact', kind: 'computer' }, { type: 'interact', kind: 'cat' }, { type: 'interact', kind: 'worldmap' }, { type: 'seat', seat: [...w.seats.values()][0], near: true }, { type: 'interact', kind: 'mediathek' }];
    const times = [];
    for (let i = 0; i < 100; i++) { const t0 = performance.now(); hud.onTarget(targets[i % targets.length]); document.querySelector('#look-label').getBoundingClientRect(); times.push(performance.now() - t0); }
    await c.wait(200);
    const after = rects();
    hud.onTarget(null);
    times.sort((a, b) => a - b);
    return { same: before === after, p50: +times[50].toFixed(3), max: +times[99].toFixed(3) };
  });
  check('a new label moves nothing else and costs well under a millisecond', jank.same && jank.p50 < 0.5 && jank.max < 3, jank);

  // ================================================================= 4. the mini player's keys ======================================
  await cc(() => {
    const rate = 8000, secs = 240, n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, n * 2, true);
    window.__episode = { id: 'hud-test-ep', title: 'Folge 3: Die Bücherei bei Nacht', audio: URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })), duration: secs };
    window.__show = { title: 'Testpodcast', artwork: '', feedUrl: '', author: 'Cozy Shelves' };
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let t = 0;
    const draw = () => { t++; ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 360); }); g.fillStyle = '#ffcf40'; g.beginPath(); g.arc(320 + Math.sin(t / 10) * 200, 180, 40, 0, Math.PI * 2); g.fill(); };
    draw(); window.__testTimer = setInterval(draw, 40);
    window.__filmItem = () => ({ id: 'hud-test-film', title: 'Testbild der Bücherei', channel: 'Cozy Shelves', stream: c.captureStream(25) });
    globalThis.__cozyshelvesPodcastPlayer.attach(window.__app.ctx);
    // the skips of the film are counted (a test pattern stream cannot seek)
    const mp = globalThis.__cozyshelvesMediaPlayer; window.__skips = [];
    const skip = mp.skip.bind(mp); mp.skip = (d) => { window.__skips.push(d); return skip(d); };
    window.__watch = 0; window.__app.ctx.bus.on('cinema:watch', () => { window.__watch++; });
  });
  const bar = () => cc(() => {
    const b = document.querySelector('#media-bar'), mp = globalThis.__cozyshelvesMediaPlayer;
    return {
      visible: !b.classList.contains('hidden'), mode: mp.mode, playing: !mp.video.paused, loaded: !!mp.current, panels: window.__hc.panels(),
      actions: [...b.querySelectorAll('.mb-foot .mb-link')].map((x) => x.querySelector('kbd').textContent + ' ' + x.querySelector('.mb-label').textContent),
      keys: [...b.querySelectorAll('.mb-keys > *')].map((x) => [...x.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + x.querySelector('.mb-label').textContent),
    };
  });
  const press = async (code, key, wait = 500) => { await cc(([c, k]) => window.__hc.key(c, k), [code, key]); await sleep(wait); };
  await cc(() => globalThis.__cozyshelvesMediaPlayer.play(window.__filmItem(), { mode: 'audio' }));
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(700);
  let s = await bar();
  check('film as sound: every action with its key cap (P F O X) and the keys K, J L, V', s.visible && s.actions.join(' | ') === 'P Auf die Leinwand | F Vollbild | O Im Fenster | X Beenden' && s.keys.join(' | ') === 'K Pause | J L 10 s | V Mediathek', s);
  await cc(() => { window.__app.world.frame(); });
  await shot('hud-08-miniplayer-film');
  // the card keeps clear of the mini player
  const clear = await cc(async () => { const c = window.__hc, e = c.book(true) || c.book(false); c.away(); c.aimBook(e); await c.wait(500); const card = c.card(); const mb = document.querySelector('#media-bar').getBoundingClientRect(); window.__app.world.frame(); return { card, barTop: Math.round(mb.top) }; });
  check('with the mini player the card stays above it and below the clock', clear.card.show && clear.card.bottom < clear.barTop - 4 && clear.card.top > 90, { top: clear.card.top, bottom: clear.card.bottom, barTop: clear.barTop, frac: clear.card.frac });
  await shot('hud-09-card-and-miniplayer');
  // look at nothing (the hall's ceiling): F must not open a book's info card
  await cc(() => window.__hc.aim(-0.8, 1.4, -0.8, 5.0, 1.3));
  await press('KeyP', 'p', 900);
  s = await bar();
  const watch1 = await cc(() => window.__watch);
  check('P puts the film onto the screen (cinema:watch), the button then says "Nur Ton"', s.mode === 'screen' && watch1 >= 1 && s.actions[0] === 'P Nur Ton', { mode: s.mode, watch: watch1, first: s.actions[0] });
  await press('KeyP', 'p', 700);
  s = await bar();
  check('P again: back to sound only', s.mode === 'audio' && s.playing, s.mode);
  await press('KeyK', 'k'); const k1 = await bar();
  await press('KeyK', 'k'); const k2 = await bar();
  check('K pauses and plays', !k1.playing && k2.playing, { k1: k1.playing, k2: k2.playing });
  await press('KeyJ', 'j', 200); await press('KeyL', 'l', 200);
  const skips = await cc(() => window.__skips.slice());
  check('J and L skip the film by 10 s', skips.join(',') === '-10,10', skips);
  await press('KeyF', 'f', 900);
  const full = await cc(() => ({ mode: globalThis.__cozyshelvesMediaPlayer.mode, open: !!document.querySelector('#film-full') && getComputedStyle(document.querySelector('#film-full')).display !== 'none' }));
  await press('Escape', 'Escape', 900);
  s = await bar();
  check('F shows the film in full screen, Esc returns to sound only', full.mode === 'full' && s.mode === 'audio', { full, after: s.mode });
  await press('KeyO', 'o', 2500);
  s = await bar();
  const inPanel = await cc(() => ({ panel: window.__hc.panels(), stage: !!document.querySelector('.mt-detail .mt-stage video') }));
  check('O opens the film in the Mediathek window', s.mode === 'panel' && inPanel.panel.includes('mediathek') && inPanel.stage, { mode: s.mode, ...inPanel });
  await cc(() => window.__app.closeAllPanels()); await sleep(1200);
  s = await bar();
  check('closing the window: the film plays on as sound', s.mode === 'audio' && s.visible, s.mode);
  await press('KeyV', 'v', 2500);
  const vPanels = await cc(() => window.__hc.panels());
  check('V opens the Mediathek', vPanels.includes('mediathek'), vPanels);
  await cc(() => window.__app.closeAllPanels()); await sleep(1200);
  await press('KeyX', 'x', 700);
  s = await bar();
  check('X stops the film, the mini player goes', !s.loaded && !s.visible, s);
  // the podcast: O opens the podcasts, J L skip 15 s, X stops
  await cc(() => globalThis.__cozyshelvesPodcastPlayer.play(window.__episode, window.__show));
  await waitFor(() => { const a = globalThis.__cozyshelvesPodcastPlayer.audio; return !a.paused && a.currentTime > 0.3; });
  await sleep(500);
  s = await bar();
  check('podcast: the actions O Podcasts, X Beenden and the keys K, J L 15 s', s.visible && s.actions.join(' | ') === 'O Podcasts | X Beenden' && s.keys.join(' | ') === 'K Pause | J L 15 s', s);
  await cc(() => window.__app.world.frame());
  await shot('hud-10-miniplayer-podcast');
  const p0 = await cc(() => globalThis.__cozyshelvesPodcastPlayer.audio.currentTime);
  await press('KeyL', 'l', 400);
  const p1 = await cc(() => globalThis.__cozyshelvesPodcastPlayer.audio.currentTime);
  check('L skips the podcast 15 s', p1 - p0 >= 13, { p0, p1 });
  await press('KeyO', 'o', 2500);
  const oPanels = await cc(() => window.__hc.panels());
  check('O opens the podcasts', oPanels.includes('podcasts'), oPanels);
  await cc(() => window.__app.closeAllPanels()); await sleep(1000);
  await press('KeyX', 'x', 700);
  const podStopped = await cc(() => ({ loaded: !!globalThis.__cozyshelvesPodcastPlayer.current, bar: !document.querySelector('#media-bar').classList.contains('hidden') }));
  check('X stops the podcast', !podStopped.loaded && !podStopped.bar, podStopped);
  await press('KeyP', 'p', 300); await press('KeyO', 'o', 300); await press('KeyX', 'x', 300);
  const idle = await cc(() => ({ panels: window.__hc.panels(), film: !!globalThis.__cozyshelvesMediaPlayer.current }));
  check('without a film or a podcast P, O and X do nothing', idle.panels.length === 0 && !idle.film, idle);

  // ================================================================= 6. the background music =======================================
  const music = () => cc(() => { const a = window.__app.ctx.audio; return { playing: a.playing, held: a.held, ducked: a.ducked, record: a.currentRecord?.id || null, platter: window.__app.world.actions.musicPlaying }; });
  await cc(() => { const a = window.__app.ctx.audio; a.init(); if (!a.playing) a.playRecord('nocturne'); });
  await sleep(1200);
  const m0 = await music();
  check('the record plays before the film', m0.playing && !m0.held && m0.record, m0);
  await cc(() => globalThis.__cozyshelvesMediaPlayer.play(window.__filmItem(), { mode: 'audio' }));
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(600);
  const m1 = await music();
  check('a film plays: the music pauses (the record waits, the platter stands still)', !m1.playing && m1.held && m1.record === m0.record && !m1.platter, m1);
  await cc(async () => { window.__app.ctx.openPanel('records', {}); });
  await sleep(1200);
  const note = await cc(() => { const n = document.querySelector('.rec-now-held'); return n ? { shown: !n.hidden, text: n.textContent } : null; });
  check('the record player says that the music waits for the film', note && note.shown && /Pausiert/.test(note.text), note);
  await shot('hud-11-records-held');
  await cc(() => window.__app.closeAllPanels()); await sleep(800);
  await cc(() => globalThis.__cozyshelvesMediaPlayer.pause());
  await sleep(1000);
  const m2 = await music();
  await sleep(2500);
  const m3 = await music();
  check('the film pauses: the music waits 2.5 s, then plays again', m2.held && !m2.playing && !m3.held && m3.playing && m3.platter, { m2, m3 });
  await cc(() => globalThis.__cozyshelvesMediaPlayer.resume());
  await sleep(800);
  const m4 = await music();
  await cc(() => globalThis.__cozyshelvesMediaPlayer.stop());
  await sleep(3500);
  const m5 = await music();
  check('the film plays again: the music pauses; the film stops: it comes back', m4.held && !m4.playing && !m5.held && m5.playing, { m4, m5 });
  await cc(() => globalThis.__cozyshelvesPodcastPlayer.play(window.__episode, window.__show));
  await waitFor(() => !globalThis.__cozyshelvesPodcastPlayer.audio.paused);
  await sleep(600);
  const m6 = await music();
  await cc(() => globalThis.__cozyshelvesPodcastPlayer.stop());
  await sleep(3500);
  const m7 = await music();
  check('a podcast pauses the music as well, it comes back after the podcast', m6.held && !m6.playing && !m7.held && m7.playing, { m6, m7 });
  // the setting off: the music only ducks; on again while a film plays: it pauses at once
  await cc(() => window.__app.ctx.api.settings.set({ audio: { pauseForMedia: false } }));
  await sleep(500);
  await cc(() => globalThis.__cozyshelvesMediaPlayer.play(window.__filmItem(), { mode: 'audio' }));
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(600);
  const m8 = await music();
  check('"Hintergrundmusik pausieren" off: the music plays on, only quieter', m8.playing && !m8.held && m8.ducked, m8);
  await cc(() => window.__app.ctx.api.settings.set({ audio: { pauseForMedia: true } }));
  await sleep(600);
  const m9 = await music();
  check('the setting on again while the film plays: the music pauses at once', m9.held && !m9.playing, m9);
  // a record chosen by hand while the film plays: it plays, and the end of the film changes nothing
  await cc(() => window.__app.ctx.audio.playRecord('kaminjazz'));
  await sleep(500);
  const m10 = await music();
  await cc(() => globalThis.__cozyshelvesMediaPlayer.stop());
  await sleep(3200);
  const m11 = await music();
  check('a record chosen by hand during the film plays anyway and keeps playing afterwards', m10.playing && m10.record === 'kaminjazz' && !m10.held && m11.playing && m11.record === 'kaminjazz', { m10, m11 });
  await cc(() => window.__app.ctx.audio.playRecord('nocturne'));
  // the settings panel: Klang and Mediathek have the switch, Mediathek the video quality
  await cc(() => window.__app.ctx.openPanel('settings', { section: 'mediathek' }));
  await sleep(1200);
  const sp = await cc(() => ({ tabs: [...document.querySelectorAll('.settings-nav button')].map((b) => b.textContent), rows: [...document.querySelectorAll('.settings-content .setting > label')].map((l) => l.firstChild?.textContent || l.textContent), seg: [...document.querySelectorAll('.settings-content .seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) }));
  check('Einstellungen → Mediathek: preferred quality (Automatisch, 1080p, 720p, 480p, 360p) and the music switch', sp.tabs.includes('Mediathek') && sp.seg.join('|') === 'Automatisch*|1080p|720p|480p|360p' && sp.rows.includes('Hintergrundmusik pausieren'), sp);
  await shot('hud-12-settings-mediathek');
  await cc(() => window.__app.closeAllPanels()); await sleep(700);

  // ================================================================= 5. the video quality ==========================================
  // 0.5 kept the last choice of the quick switch in localStorage: it becomes the setting once
  const migrated = await cc(async () => {
    localStorage.setItem('lesesaal.media.quality', 'low');
    globalThis.__cozyshelvesMediaPlayer.bindContext(window.__app.ctx);
    await new Promise((r) => setTimeout(r, 600));
    const s = await window.api.settings.get();
    const r = { setting: s.mediathek?.quality, left: localStorage.getItem('lesesaal.media.quality') };
    await window.api.settings.set({ mediathek: { quality: 'auto' } });
    return r;
  });
  check('the quality remembered by 0.5 becomes the setting once (Niedrig → 360p)', migrated.setting === 360 && migrated.left === null, migrated);
  if (!net) console.log('SKIP network parts of the video quality (HQ_NET=0)');
  else {
    const item = await cc(async () => {
      const q = await window.api.invoke('mediathek:query', { topic: 'tagesschau in 100 Sekunden', channels: ['ARD'], size: 10 }).catch(() => null);
      const ok = (x) => x?.video?.low && x.video.sd && x.video.hd && new Set([x.video.low, x.video.sd, x.video.hd]).size === 3;
      let it = (q?.items || []).find(ok);
      // a ZDF film of a few minutes (the quick switch seeks to 20 s)
      if (!it) { const q2 = await window.api.invoke('mediathek:query', { channels: ['ZDF'], durationMin: 120, durationMax: 600, size: 15 }).catch(() => null); it = (q2?.items || []).find(ok); }
      return it || null;
    });
    if (!item) check('a short Mediathek film with three qualities (network)', false, 'none found');
    else {
      const mpState = () => cc(() => { const p = globalThis.__cozyshelvesMediaPlayer; return { choice: p.state.choice, quality: p.state.quality, level: p.state.level, height: p.state.height, qualities: p.state.qualities.map((q) => q.id), sizes: p.state.qualities.map((q) => q.height || 0), t: +p.video.currentTime.toFixed(1), paused: p.video.paused, src: (p.video.currentSrc || '').slice(0, 40), music: window.__app.ctx.audio.held }; });
      await cc((it) => window.__app.ctx.openPanel('mediathek', { play: it }), item);
      const started = await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.current && p.video.currentTime > 2 && !p.video.paused; }, null, 60000);
      let q = await mpState();
      check('a film starts with the setting (Automatisch → 1080p in a 960 px high window), all sizes offered, biggest first', started && q.choice === 'auto' && q.quality === 'hd' && q.height === 1080 && q.qualities.join(',') === 'auto,hd,sd,low' && q.sizes[1] > q.sizes[2] && q.sizes[2] > q.sizes[3], { title: item.title, ...q });
      check('the music pauses while the Mediathek film plays in the window', q.music === true, q.music);
      // Automatisch goes one step down after three stalls (simulated with the element's own events) and stays there
      await waitFor(() => globalThis.__cozyshelvesMediaPlayer.video.currentTime > 5.5, null, 30000);
      await cc(() => { const v = globalThis.__cozyshelvesMediaPlayer.video; for (let i = 0; i < 3; i++) { v.dispatchEvent(new Event('waiting')); v.dispatchEvent(new Event('playing')); } });
      await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'sd' && !p.video.paused && p.video.readyState >= 3; }, null, 40000);
      q = await mpState();
      check('Automatisch: three stalls take the film one step down (HD → Mittel), the choice stays Automatisch', q.choice === 'auto' && q.quality === 'sd' && !q.paused, q);
      // the quick switch in the player: the menu marks "Automatisch", a click on "Niedrig" keeps the position
      await cc(() => { const st = document.querySelector('.mt-detail .mt-stage'); st.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); });
      await page.click('.mt-detail .mt-qwrap .mt-cbtn');
      await sleep(400);
      const menu = await cc(() => [...document.querySelectorAll('.mt-qmenu .mt-qitem')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')));
      await shot('hud-13-quality-menu');
      check('the quick switch lists Automatisch and the picture sizes and marks the choice', menu.length === 4 && /^Automatisch.*\*$/.test(menu[0]) && menu.slice(1).every((m) => /^\d+p$/.test(m)), menu);
      // a little into the film, so that "the same place" means something
      await cc(() => globalThis.__cozyshelvesMediaPlayer.seek(20));
      await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.video.currentTime > 21 && !p.video.paused; }, null, 30000);
      const before = (await mpState()).t;
      await page.click('.mt-qmenu .mt-qitem[data-q="low"]');
      await waitFor((b) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'low' && p.video.currentTime > b - 2 && !p.video.paused && p.video.readyState >= 3; }, before, 40000);
      q = await mpState();
      check('"Niedrig" in the quick switch: the film goes on at the same place in the low quality', q.choice === 'low' && q.quality === 'low' && q.t >= before - 2 && q.t < before + 15 && !q.paused && /^media:\/\/proxy/.test(q.src), { before, ...q });
      const btn = await cc(() => document.querySelector('.mt-detail .mt-qwrap .mt-cbtn').textContent);
      check('the quality button shows the size that plays', /^\d+p$/.test(btn) && btn === `${q.height}p`, btn);
      // a new setting applies to the running film as well (the panel draws its page again after every change of the
      // settings, so the film goes on in the small dock of the panel)
      const b2 = (await mpState()).t;
      await cc(() => window.api.settings.set({ mediathek: { quality: 720 } }));
      await waitFor((b) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'sd' && p.video.currentTime > b - 2 && !p.video.paused && p.video.readyState >= 3; }, b2, 40000);
      q = await mpState();
      check('Einstellungen → Bevorzugte Qualität 720p: the running film follows at the same place', q.choice === 720 && q.quality === 'sd' && q.height === 720 && q.t >= b2 - 2 && q.t < b2 + 15, { b2, ...q });
      await cc(() => { const p = globalThis.__cozyshelvesMediaPlayer; p.stop(); window.__app.closeAllPanels(); });
      await sleep(1200);
      // the download menu marks the setting's quality ("Mittel"), Automatisch marks HD
      const dlMenu = async () => {
        await cc((it) => window.__app.ctx.openPanel('mediathek', { open: it }), item);
        await page.waitForSelector('.mt-detail:not(.hidden) .mt-act-dl', { timeout: 20000 }).catch(() => {});
        await sleep(800);
        await page.click('.mt-detail:not(.hidden) .mt-act-dl');
        await sleep(700);
        return cc(() => [...document.querySelectorAll('.mt-dlq-item')].map((b) => b.dataset.q + (b.classList.contains('default') ? '*' : '')));
      };
      const dlSd = await dlMenu();
      await shot('hud-14-download-default');
      await cc(() => window.__app.closeAllPanels()); await sleep(900);
      await cc(() => window.api.settings.set({ mediathek: { quality: 'auto' } }));
      await sleep(600);
      const dlAuto = await dlMenu();
      await cc(() => window.__app.closeAllPanels()); await sleep(900);
      check('the download menu marks the size closest to the setting (720p; the biggest for Automatisch)', dlSd.join(',') === 'hd,sd*,low' && dlAuto.join(',') === 'hd*,sd,low', { dlSd, dlAuto });
      await sleep(600);
      // a live channel: HLS levels with hls.js, the quick switch picks a level
      await cc(() => window.__app.ctx.openPanel('mediathek', { section: 'live' }));
      await page.waitForSelector('.mt-live-card', { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      // ZDF first; its CDN refuses some connections with 403, then Das Erste
      let live = false;
      for (const id of ['zdf', 'das_erste']) {
        await page.click(`.mt-live-card[data-live="${id}"]`).catch(() => {});
        await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.error || (p.current && p.video.currentTime > 2 && !p.video.paused); }, null, 60000);
        live = await waitFor(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.current && p.video.currentTime > 2 && !p.video.paused; }, null, 1000);
        if (live) break;
        await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); document.querySelector('.mt-detail .mt-back')?.click(); });
        await sleep(800);
      }
      q = await mpState();
      check('live TV (HLS): Automatisch with the levels as picture sizes', live && q.choice === 'auto' && q.qualities[0] === 'auto' && q.qualities.length >= 3 && q.qualities.slice(1).every((id) => /^h\d+$/.test(id)), q);
      const smallest = q.qualities[q.qualities.length - 1];
      await cc((k) => globalThis.__cozyshelvesMediaPlayer.setQuality(k), smallest);
      await waitFor(() => { const h = globalThis.__cozyshelvesMediaPlayer.hls; if (!h || !h.levels?.length) return false; const hs = h.levels.map((l) => l.height); return hs[h.currentLevel] === Math.min(...hs); }, null, 30000);
      await sleep(1500);
      q = await mpState();
      const lvl = await cc(() => { const h = globalThis.__cozyshelvesMediaPlayer.hls; return h ? { current: h.currentLevel, heights: h.levels.map((l) => l.height) } : null; });
      check('live TV: the smallest size switches to the lowest level and keeps playing', q.choice === smallest && !q.paused && lvl && lvl.heights[lvl.current] === Math.min(...lvl.heights) && q.level, { q, lvl });
      await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); window.__app.closeAllPanels(); });
      await sleep(1000);
    }
  }

  // ---- clean up ------------------------------------------------------------------------------------------------------------------
  await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); globalThis.__cozyshelvesPodcastPlayer.stop(); clearInterval(window.__testTimer); });
  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`HUD-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
