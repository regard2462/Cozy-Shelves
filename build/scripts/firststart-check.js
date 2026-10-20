// The first start for everyone: no books folder is added on its own, a welcome card asks for one, "Später" leaves an
// empty but tidy library, choosing a folder (the system dialog is replaced by a stand-in) fills it, and the card
// comes back only while no folder is set. Three starts with the same COZYSHELVES_USERDATA, without COZYSHELVES_BOOKS:
//   FS_PHASE=first   (a fresh, empty COZYSHELVES_USERDATA; FS_LIB=<a small test library: a few books in sub folders>)
//   FS_PHASE=restart (the folder chosen in the first start is kept: no card; then the folder is removed in the settings)
//   FS_PHASE=again   (no folder set any more: the card is back)
// SHOT_TAG prefixes the screenshot names (default 'fs').
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const phase = process.env.FS_PHASE || 'first';
  const tag = process.env.SHOT_TAG || 'fs';
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  const done = () => {
    check('no errors in the renderer', errors.length === 0, errors.slice(0, 5));
    const failed = results.filter((r) => !r.ok);
    console.log(`FIRSTSTART-CHECK (${phase}) ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
  };
  if (process.env.COZYSHELVES_BOOKS) { check('runs without COZYSHELVES_BOOKS', false, process.env.COZYSHELVES_BOOKS); return done(); }

  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const mainSettings = () => page.evaluate(() => window.__app.ctx.api.settings.get());
  const card = () => page.evaluate(() => {
    const c = document.querySelector('.welcome-card');
    if (!c) return null;
    const layer = c.closest('.panel-layer');
    return {
      open: !!layer && layer.classList.contains('open') && !layer.classList.contains('closing'),
      title: c.querySelector('.wel-title')?.textContent, choose: c.querySelector('.wel-choose')?.textContent, later: c.querySelector('.wel-later')?.textContent,
      modes: [...c.querySelectorAll('.wel-mode')].map((b) => ({ mode: b.dataset.mode, name: b.querySelector('.wel-mode-name')?.textContent, on: b.getAttribute('aria-checked') === 'true' })),
      top: document.querySelector('#panels > .panel-layer:last-child')?.dataset.panel, focus: document.activeElement?.className || '',
    };
  });
  const waitCard = async (want, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const c = await card(); if (want ? c?.open : !c) return c; await sleep(200); } return card(); };
  const settle = async (n = 10) => { for (let i = 0; i < n; i++) { await page.evaluate(() => window.__app.world.frame()); await sleep(50); } };
  const pose = (x, z, yaw, pitch) => page.evaluate(([x, z, yaw, pitch]) => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.player.transition = null; w.player.setPose(x, z, yaw, pitch); }, [x, z, yaw, pitch]);
  const emptyRoom = () => page.evaluate(() => {
    const w = window.__app.world, L = w.layout;
    const waiting = L.bookcases.filter((bc) => bc.waiting);
    let cardMesh = null, decor = 0;
    w.shelfGroup?.traverse((o) => { if (o.name === 'waiting-card') cardMesh = o; });
    w.shelfGroup?.getObjectByName('shelfdecor')?.traverse((o) => { if (o.isInstancedMesh) decor += o.count; });
    return {
      books: window.__app.state.library.books.length, empty: !!L.emptyLibrary, waiting: waiting.length, walls: [...new Set(waiting.map((bc) => bc.wall))],
      sign: (L.signs || []).filter((s) => s.kind === 'department').map((s) => s.text), directory: L.directory?.entries?.map((e) => e.name.de),
      card: !!cardMesh, decor, signKeys: w.signs.entries('card').map((e) => e.key.split('|').slice(2).join(' / ')), dirKey: (w.signs.entries('directory')[0]?.key || '').slice(0, 2000),
    };
  });

  if (phase === 'first') {
    const lib = process.env.FS_LIB;
    const s0 = await mainSettings();
    check('the first start adds no folder on its own', Array.isArray(s0.folders) && s0.folders.length === 0, s0.folders);
    let c = await waitCard(true);
    check('the welcome card appears on the first start, over the start menu', c?.open && c.top === 'welcome' && c.title === 'Willkommen in Cozy Shelves', c);
    check('it offers "Ordner mit Büchern wählen" with both ways of sorting, and "Später"', /Ordner mit Büchern wählen/.test(c?.choose || '') && /Später/.test(c?.later || '')
      && c?.modes.map((m) => m.name).join('|') === 'Unterordner sind Abteilungen|Automatisch einsortieren' && c?.modes[0].on, c);
    check('the button to choose a folder has the focus (Enter chooses it)', /wel-choose/.test(c?.focus || ''), c?.focus);
    await sleep(600);
    await shot(`${tag}-welcome-de`);
    // the language switch on the card changes it at once
    await page.click('.welcome-card [data-lang="en"]');
    await sleep(500);
    c = await card();
    check('the language switch on the card changes it to English at once', c?.title === 'Welcome to Cozy Shelves' && /Choose a folder with books/.test(c.choose) && /Later/.test(c.later)
      && c.modes.map((m) => m.name).join('|') === 'Sub folders are departments|Sort automatically', c);
    await shot(`${tag}-welcome-en`);
    await page.click('.welcome-card [data-lang="de"]');
    await sleep(500);
    check('and back to German', (await card())?.title === 'Willkommen in Cozy Shelves');
    // keys: 2 and 1 pick the way of sorting, the arrow keys move between them
    await page.keyboard.press('2'); await sleep(150);
    const m2 = (await card())?.modes.find((m) => m.on)?.mode;
    await page.keyboard.press('ArrowUp'); await sleep(150);
    const m3 = (await card())?.modes.find((m) => m.on)?.mode;
    await page.keyboard.press('1'); await sleep(150);
    const m1 = (await card())?.modes.find((m) => m.on)?.mode;
    check('keys 1 and 2 and the arrow keys pick the way of sorting', m2 === 'auto' && m3 === 'structured' && m1 === 'structured', { m2, m3, m1 });
    // Tab walks through everything on the card
    const tabs = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); await sleep(60); tabs.push(await page.evaluate(() => { const a = document.activeElement; return a?.closest('.welcome-card') ? (a.dataset.lang || a.dataset.mode || a.className.split(' ').find((k) => k.startsWith('wel-')) || a.tagName) : 'outside'; })); }
    check('Tab reaches every button of the card', ['wel-choose', 'wel-later', 'de', 'en'].every((k) => tabs.includes(k)) && tabs.some((k) => k === 'structured' || k === 'auto'), tabs);
    // the card fits the smallest window (1024 × 640) and a large one (2560 × 1440), in every appearance
    const size0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => /index\.html/.test(w.webContents.getURL())).getContentSize());
    const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())).setContentSize(w, h), [w, h]);
    const fit = () => page.evaluate(() => {
      const r = document.querySelector('.welcome-card').getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const inside = (el) => { const b = el.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1 && b.left >= r.left - 1 && b.right <= r.right + 1; };
      const card = document.querySelector('.welcome-card');
      return { vw, vh, card: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], fits: r.top >= 0 && r.left >= 0 && r.bottom <= vh && r.right <= vw,
        scroll: card.scrollHeight - card.clientHeight, buttons: [...card.querySelectorAll('button')].every(inside) };
    });
    const sizes = {};
    for (const [name, w, h, theme] of [['small', 1024, 640, 'sepia'], ['large', 2560, 1440, 'sepia'], ['dark', 1600, 900, 'dark'], ['light', 1600, 900, 'light']]) {
      await page.evaluate((t) => window.__app.ctx.setTheme(t), theme);
      await setSize(w, h); await sleep(700);
      sizes[name] = await fit();
      await shot(`${tag}-welcome-${name}`);
    }
    await page.evaluate(() => window.__app.ctx.setTheme('sepia'));
    await setSize(size0[0], size0[1]); await sleep(500);
    check('the card fits the window from 1024 × 640 to 2560 × 1440, every button on it, in Sepia, Dark and Light', Object.values(sizes).every((s) => s.fits && s.buttons && s.scroll <= 0), sizes);

    // "Später" (Esc): the card goes, the start menu stays
    await page.keyboard.press('Escape');
    c = await waitCard(false);
    const menuOpen = await page.evaluate(() => document.querySelector('#panels > .panel-layer:last-child')?.dataset.panel);
    check('Esc ("Später") closes the card, the start menu stays', !c && menuOpen === 'menu', { c, menuOpen });
    const s1 = await mainSettings();
    check('"Später" adds no folder', s1.folders.length === 0, s1.folders);

    // the empty library: tidy, with empty cases that wait for books and say how they get in
    await page.evaluate(() => { document.querySelector('.menu-btn.primary').click(); });
    await sleep(2500);
    await page.evaluate(() => { window.__app.world.stop(); });
    const e = await emptyRoom();
    check('the book room without books: four empty cases on the left wall, under the sign "Deine Bücher"', e.books === 0 && e.empty && e.waiting === 4 && e.walls.join() === 'left' && e.sign.length === 1 && e.sign[0].de === 'Deine Bücher' && e.sign[0].en === 'Your books', e);
    check('a card on the first case and the directory in the passage say how books get in', e.card && e.signKeys.some((k) => /Hier stehen bald/.test(k) && /Bücherordner/.test(k)) && /Bücher hinzufügen: Esc → Einstellungen → Bücherordner/.test(e.dirKey) && e.directory?.[0] === 'Deine Bücher', { card: e.card, signKeys: e.signKeys, directory: e.directory });
    check('the waiting cases are furnished (plants, vases, photos on their shelves)', e.decor >= 6, e.decor);
    await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '0'); });
    const views = await page.evaluate(() => {
      const L = window.__app.world.layout, w = L.bookcases.filter((bc) => bc.waiting), first = w[0], mid = w[Math.floor(w.length / 2)];
      const f = (bc, d, side = 0) => { const fx = Math.sin(bc.rot), fz = Math.cos(bc.rot); return [bc.x + fx * d + fz * side, bc.z + fz * d - fx * side, Math.atan2(fx, fz)]; };
      const d = L.directory;
      return {
        cases: [...f(mid, 3.2, 0.6), 0.1], card: [...f(first, 1.05), -0.12],
        directory: [d.x + Math.sin(d.rot) * 1.6, d.z + Math.cos(d.rot) * 1.6, d.rot, -0.05],
        room: [0, -10.2, 0, 0.02], back: [0, -21.2, Math.PI, 0.04], passage: [0, -6.3, 0.35, 0.02],
      };
    });
    for (const [name, v] of Object.entries(views)) { await pose(...v); await settle(12); await shot(`${tag}-empty-${name}`); }
    // the texts in the room follow the language
    await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'en' }));
    await sleep(1200); await settle(8);
    const en = await emptyRoom();
    check('in English the card and the directory read "Your books will stand here soon" and "Add books: Esc → Settings → Book folders"', en.signKeys.some((k) => /Your books will/.test(k) && /Book folders/.test(k)) && /Add books: Esc → Settings → Book folders/.test(en.dirKey), { signKeys: en.signKeys });
    await pose(...views.card); await settle(12); await shot(`${tag}-empty-card-en`);
    await page.evaluate(() => window.__app.ctx.api.settings.set({ language: 'de' }));
    await sleep(800);
    await page.evaluate(() => { document.querySelector('#hud')?.style.setProperty('opacity', '1'); });

    // Esc in the library: the start page of the menu offers the card again
    await page.evaluate(() => window.__app.openPanel('menu', {}));
    await sleep(700);
    const hint = await page.evaluate(() => { const b = document.querySelector('.menu-nofolder button'); return b ? { text: b.textContent, note: document.querySelector('.menu-nofolder')?.textContent } : null; });
    check('the menu says that no folder is chosen yet and offers the card', !!hint && /Ordner mit Büchern wählen/.test(hint.text), hint);
    await shot(`${tag}-menu-nofolder`);
    await page.evaluate(() => document.querySelector('.menu-nofolder button').click());
    c = await waitCard(true);
    check('the button opens the welcome card', c?.open, c);

    // the system dialog, cancelled: nothing changes
    await app.evaluate(({ dialog }) => { dialog.__orig ||= dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.click('.welcome-card .wel-choose');
    await sleep(800);
    c = await card();
    check('a cancelled dialog keeps the card and adds nothing', c?.open && (await mainSettings()).folders.length === 0, c);

    // the system dialog picks a library: the folder is added with the chosen way of sorting and the library fills
    if (!lib) check('FS_LIB names a test library', false);
    else {
      await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async (win, opts) => { dialog.__lastTitle = opts?.title || ''; return { canceled: false, filePaths: [d] }; }; }, path.resolve(lib));
      await page.keyboard.press('2'); await sleep(100);
      await page.keyboard.press('1'); await sleep(100);
      await page.click('.welcome-card .wel-choose');
      c = await waitCard(false);
      const title = await app.evaluate(({ dialog }) => dialog.__lastTitle);
      const s2 = await mainSettings();
      check('choosing a folder adds it with the chosen way of sorting and closes the card', !c && s2.folders.length === 1 && path.resolve(s2.folders[0].path) === path.resolve(lib) && s2.folders[0].mode === 'structured', s2.folders);
      check('the dialog has a title in the language of the app', title === 'Ordner mit Büchern wählen', title);
      const toast = await page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).pop() || '');
      check('a short note says that the books are read in', /Die Bücher werden eingelesen/.test(toast), toast);
      let st = null;
      for (let i = 0; i < 90; i++) {
        st = await page.evaluate(() => { const s = window.__app.state, L = window.__app.world.layout; return { books: s.library.books.length, idx: s.library.books.filter((b) => b.indexed).length, deps: s.library.departments.length, waiting: L.bookcases.filter((bc) => bc.waiting).length, cases: L.bookcases.filter((bc) => bc.dep).length, empty: !!L.emptyLibrary }; });
        if (st.books > 0 && st.cases > 0 && !st.waiting) break;
        await sleep(1000);
      }
      check('the library fills: departments on the walls, the waiting cases are gone', st.books > 0 && st.deps > 0 && st.cases > 0 && st.waiting === 0 && !st.empty, st);
      await page.evaluate(() => { const m = document.querySelector('.menu-welcome'); return !!m; });
      await page.evaluate(() => window.__app.closeAllPanels());
      await pose(0, -10.2, 0, 0.02); await settle(12); await shot(`${tag}-filled-room`);
      await app.evaluate(({ dialog }) => { if (dialog.__orig) dialog.showOpenDialog = dialog.__orig; });
    }
  } else if (phase === 'restart') {
    await sleep(3000);
    const c = await card();
    const s = await mainSettings();
    check('a second start with a folder set shows no welcome card', !c, c);
    check('the folder of the first start is kept', s.folders.length === 1, s.folders);
    // the last folder removed in the settings: the room goes back to its waiting cases, the menu offers the card
    await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
    await sleep(1500);
    await page.evaluate(() => window.__app.openPanel('settings', { section: 'library' }));
    await sleep(800);
    await page.evaluate(() => [...document.querySelectorAll('.settings-panel .folder-row button')].find((b) => /Entfernen/.test(b.textContent))?.click());
    await sleep(1500);
    const s2 = await mainSettings();
    check('removing the folder in the settings leaves none', s2.folders.length === 0, s2.folders);
    await page.evaluate(() => window.__app.closeAllPanels());
    let e = null;
    for (let i = 0; i < 30; i++) { e = await emptyRoom(); if (e.empty && e.waiting === 4) break; await sleep(1000); }
    check('without a folder the room shows its waiting cases again', e.books === 0 && e.empty && e.waiting === 4, e);
  } else if (phase === 'again') {
    const c = await waitCard(true);
    const s = await mainSettings();
    check('a start without a folder shows the welcome card again', c?.open && c.title === 'Willkommen in Cozy Shelves' && s.folders.length === 0, { c, folders: s.folders });
    await page.keyboard.press('Escape');
    check('Esc closes it', !(await waitCard(false)));
  }
  done();
};
