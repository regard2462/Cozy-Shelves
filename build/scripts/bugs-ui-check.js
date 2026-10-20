// Regression checks of the interface bug hunt (docs/strands/bugs-ui.md). Runs muted and hidden like every harness script.
//   padbar   the mini player of an audiobook with the gamepad: its row of pad keys (15 s · 30 s, Bedienen), the D-pad
//            skips 15 s back and 30 s forward like J and L (COZYSHELVES_AUDIOBOOKS with a test audiobook folder)
//   chessrace chess against Stockfish in the computer: Enter twice while the engine starts, and "Neu" before it is up,
//            leave one board, no stray document listener and no claim on the shared engine behind
//   tabs     Tab and Shift+Tab stay inside the open panel while the mini player (a film as sound) sits in the HUD
//            behind it (ui/panels.js trapTab)
//   lang     the interface in English: no German label, title, placeholder or heading in the HUD or any panel;
//   langlive the same with the language switched while each panel is open
//   leaks    every panel opened and closed BU_CYCLES times (4): the listeners of the bus, of window and document, the
//            DOM nodes and the heap must not grow cycle after cycle
//   layout   every panel at 1024×640 and 2560×1440 (BU_SIZES) in Hell, Sepia and Dunkel (BU_THEMES): the panel fits
//            the window, nothing scrolls the page sideways, the header keeps its buttons inside the panel, no renderer
//            error; pictures of the small size in BU_SHOT_THEME (sepia)
//   node build/screenshot.js bugs-ui-check   (COZYSHELVES_BOOKS="<library>|structured", COZYSHELVES_USERDATA, SHOT_DIR,
//   COZYSHELVES_AUDIOBOOKS=<folder>; BU_PARTS=padbar,chessrace,tabs,lang,langlive,leaks,layout; BU_CYCLES=4;
//   BU_SHOTS=0 takes no pictures)
module.exports = async ({ app, page, shot, sleep }) => {
  // the world map opens here many times: its tiles come from the check (osm-tiles.js), never from OpenStreetMap
  await require('./osm-tiles.js').serveTiles({ page, app });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  const ignore = /pointer lock|ERR_|net::|favicon|Failed to load resource|Invalid guestInstanceId|ResizeObserver loop/i;
  page.on('pageerror', (e) => { if (!ignore.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !ignore.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const parts = (process.env.BU_PARTS || 'padbar,chessrace,tabs,lang,langlive,leaks,layout').split(',');
  const want = (p) => parts.includes(p);
  const shots = process.env.BU_SHOTS !== '0';
  const pic = async (name) => { if (shots) await shot(name); };
  const waitFor = async (fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win.setContentSize(w, h); }, [w, h]);
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); await cdp.send('HeapProfiler.enable'); } catch (e) { console.log('[bu] no CDP session: ' + e.message); }
  const gc = async () => { if (cdp) { try { await cdp.send('HeapProfiler.collectGarbage'); } catch {} } };

  // ---- boot -------------------------------------------------------------------------------------------------------
  await setSize(1600, 960);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await cc(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await cc(() => { const b = window.__app.state.library.books; return { n: b.length, idx: b.filter((x) => x.indexed).length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '' }; });
    if (st.n > 0 && !st.active && !st.hud && st.idx === st.n) break;
    await sleep(2000);
  }
  await sleep(1500);
  await cc(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  await sleep(600);
  const bookId = await cc(() => window.__app.state.library.books.find((b) => b.format === 'epub')?.id || window.__app.state.library.books[0]?.id || null);

  // ================================================================= padbar =================================================
  if (want('padbar')) {
    const abIds = await cc(async () => { try { const s = await window.api.invoke('audiobooks:state'); return (s?.books || []).map((b) => b.id); } catch { return []; } });
    if (!abIds.length) console.log('[bu] padbar: no audiobooks (COZYSHELVES_AUDIOBOOKS not set?), part skipped');
    else {
      // the scripted pad of controller-check: a standard mapping, stepped by the check itself
      await cc(() => {
        const IDX = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16 };
        const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
        const P = window.__app.pad, w = window.__app.world;
        window.__bp = {
          pad,
          set(name, on) { const b = pad.buttons[IDX[name]]; b.pressed = !!on; b.value = on ? 1 : 0; pad.timestamp++; },
          step(n = 1) { for (let i = 0; i < n; i++) { P.step(1 / 60); w.player.update(1 / 60); w.actions.rayTimer = 0; w.actions.update(1 / 60); } },
          tap(name) { this.set(name, true); this.step(1); this.set(name, false); this.step(1); },
          aim(x, z, tx, ty, tz) { const p = w.player; if (w.actions.seatedId || p.seated) w.actions.leaveSeat(); p.transition = null; p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - 1.62, Math.hypot(tx - x, tz - z))); },
        };
        const e = new Event('gamepadconnected'); e.gamepad = pad; window.dispatchEvent(e);
        P.paused = true;
      });
      await sleep(400);
      // a film first: its pad row shows "10 s"; the audiobook that follows must show its own
      await cc(() => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 180;
        const g = c.getContext('2d'); g.fillStyle = '#c0c000'; g.fillRect(0, 0, 320, 180);
        window.__buTimer = setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 40, 40); }, 60);
        globalThis.__cozyshelvesMediaPlayer.play({ id: 'bu-film', title: 'Testbild', channel: 'Cozy Shelves', stream: c.captureStream(15) }, { mode: 'audio' });
      });
      await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused, null, 15000);
      const filmRow = await cc(() => { const f = window.__bp; f.aim(-0.8, 1.4, -0.8, 5.0, 1.3); f.tap('l3'); f.tap('l3'); return { input: document.documentElement.dataset.input || null, row: [...document.querySelectorAll('#media-bar .mb-padkeys > .mb-key')].map((k) => k.textContent.trim()) }; });
      check('a film as sound with the pad: the mini player\'s pad row says 10 s', filmRow.input === 'pad' && filmRow.row.length === 2 && /10 s/.test(filmRow.row[0]), filmRow);
      // now the audiobook: the row must change to 15 s · 30 s, the D-pad skips 15 back and 30 forward
      const ab = await cc(async (id) => {
        const P = globalThis.__cozyshelvesAudiobookPlayer, f = window.__bp;
        globalThis.__cozyshelvesMediaPlayer.stop(); clearInterval(window.__buTimer);
        const ok = await P.open(id, { play: true });
        await new Promise((r) => setTimeout(r, 1200));
        const skips = [];
        const skip = P.skip.bind(P); P.skip = (d) => { skips.push(d); return skip(d); };
        f.aim(-0.8, 1.4, -0.8, 5.0, 1.3); f.step(2);
        const bar = document.querySelector('#media-bar');
        const padkeys = bar.querySelector('.mb-padkeys');
        const row = [...padkeys.querySelectorAll('.mb-key')].map((k) => k.textContent.trim());
        const visible = getComputedStyle(padkeys).display !== 'none';
        f.tap('right'); f.tap('left');
        P.skip = skip;
        return { ok, hidden: bar.classList.contains('hidden'), audiobook: bar.classList.contains('audiobook'), visible, empty: !padkeys.children.length, row, skips, playing: !P.audio.paused, title: bar.querySelector('.mb-title')?.textContent || '' };
      }, abIds[0]);
      check('an audiobook with the pad: the mini player shows it', ab.ok && !ab.hidden && ab.audiobook && ab.playing, ab);
      check('its pad row is neither empty nor the film\'s: 15 s · 30 s and "Bedienen"', ab.visible && !ab.empty && ab.row.length === 2 && /15 s · 30 s/.test(ab.row[0]) && /Bedienen|Controls/.test(ab.row[1]), ab);
      check('the D-pad skips an audiobook 30 s forward and 15 s back, like L and J', ab.skips.join(',') === '30,-15', ab.skips);
      await cc(() => window.__app.world.frame());
      await pic('bu-01-audiobook-pad');
      await cc(() => { globalThis.__cozyshelvesAudiobookPlayer.stop(); window.__app.pad.setActive(false); });
      await sleep(300);
    }
  }

  // count the listeners of window and document by type (adds minus removes, by target, type, function and capture)
  const installListen = () => cc(() => {
    if (window.__buListen) return;
    const live = new Map();
    const keyOf = (t, type, fn, opts) => { const cap = typeof opts === 'boolean' ? opts : !!opts?.capture; return [t === window ? 'window' : 'document', type, cap].join('|'); };
    const fns = new Map();   // key → Set of functions
    for (const t of [window, document]) {
      const add = t.addEventListener.bind(t), rem = t.removeEventListener.bind(t);
      t.addEventListener = (type, fn, opts) => { const k = keyOf(t, type, fn, opts); if (!fns.has(k)) fns.set(k, new Set()); if (fn && !fns.get(k).has(fn)) { fns.get(k).add(fn); live.set(k, (live.get(k) || 0) + 1); } return add(type, fn, opts); };
      t.removeEventListener = (type, fn, opts) => { const k = keyOf(t, type, fn, opts); if (fn && fns.get(k)?.has(fn)) { fns.get(k).delete(fn); live.set(k, (live.get(k) || 0) - 1); } return rem(type, fn, opts); };
    }
    window.__buListen = { snapshot: () => Object.fromEntries([...live].filter(([, n]) => n > 0)) };
  });

  // ================================================================= chessrace ==============================================
  if (want('chessrace')) {
    await installListen();
    const key = (k) => cc((k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })), k);
    const listeners = () => cc(() => { const w = window.__buListen.snapshot(); return { total: Object.values(w).reduce((a, b) => a + b, 0), by: w }; });
    const refs = () => cc(() => (typeof window.__chessEngineRefs === 'function' ? window.__chessEngineRefs() : null));
    const diff = (a, b) => Object.fromEntries(Object.entries(b.by).filter(([k, v]) => v !== (a.by[k] || 0)).map(([k, v]) => [k, v - (a.by[k] || 0)]));
    const setupShown = () => waitFor(() => !!document.querySelector('.term-setup'), null, 20000);
    const engineUp = () => waitFor(() => { const s = document.querySelector('.term-chess-status')?.textContent || ''; return /am Zug|Your move|beginnt|opens|nicht verfügbar|unavailable|Keine Engine|No engine/.test(s); }, null, 60000);
    await cc(() => window.__app.openPanel('computer', { section: 'games', game: 'chess' }));
    const setup = await setupShown();
    await sleep(400);
    const l0 = await listeners();
    // 1. Enter twice while the engine starts: one game, one board, one claim on the engine
    await key('Enter'); await key('Enter');
    const up = await engineUp();
    await sleep(400);
    const boards = await cc(() => document.querySelectorAll('.term-chess-board').length);
    await key('n'); await setupShown(); await sleep(600);
    const l1 = await listeners(), r1 = await refs();
    check('chess against Stockfish: a second Enter while the engine starts does not start a second game (no board, no document listener stays behind, the engine is released)', setup && up && boards === 1 && l1.total === l0.total && r1 === 0, { setup, up, boards, listeners: diff(l0, l1), refs: r1 });
    // 2. "Neu" right after Enter, before the engine is up: the claim made meanwhile is given back
    await key('Enter'); await sleep(50); await key('n'); await setupShown();
    await sleep(4000);
    const l2 = await listeners(), r2 = await refs();
    check('chess against Stockfish: leaving while the engine starts releases the engine and the board', l2.total === l0.total && r2 === 0, { listeners: diff(l0, l2), refs: r2 });
    await cc(() => window.__app.closeAllPanels());
    await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
    await sleep(300);
  }

  // ================================================================= tabs ==================================================
  if (want('tabs')) {
    // Tab walks through the open panel and stays inside it: the HUD, the mini player and the world behind the scrim
    // are not reachable by the keyboard while a panel is open
    const PANELS = ['menu', 'settings', 'basket', 'records', 'computer', 'catalog', 'news', 'podcasts', 'wiki', 'chess', 'watercolor', 'gallery', 'mediathek', 'worldmap', 'audiobooks', 'duplicates', 'search', 'bookinfo', 'reader'];
    // a film as sound first: the mini player with its buttons sits in the HUD behind the panel
    await cc(() => {
      const c = document.createElement('canvas'); c.width = 320; c.height = 180;
      const g = c.getContext('2d'); g.fillStyle = '#c0c000'; g.fillRect(0, 0, 320, 180);
      window.__buTimer = setInterval(() => { g.fillStyle = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'); g.fillRect(0, 0, 40, 40); }, 60);
      globalThis.__cozyshelvesMediaPlayer.play({ id: 'bu-film', title: 'Testbild', channel: 'Cozy Shelves', stream: c.captureStream(15) }, { mode: 'audio' });
    });
    await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused, null, 15000);
    const bar = await cc(() => ({ hidden: document.querySelector('#media-bar')?.classList.contains('hidden'), buttons: document.querySelectorAll('#media-bar button').length }));
    check('the mini player shows the film with its buttons (the keyboard must not reach them through a panel)', !bar.hidden && bar.buttons > 0, bar);
    for (const name of PANELS) {
      const params = name === 'reader' || name === 'bookinfo' ? { id: bookId } : name === 'search' ? { q: 'Buch' } : {};
      if ((name === 'reader' || name === 'bookinfo') && !bookId) continue;
      await cc(([n, p]) => window.__app.openPanel(n, p), [name, params]);
      const opened = await waitFor((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n && l.classList.contains('open')), name, 20000);
      await sleep(name === 'reader' || name === 'worldmap' ? 2000 : 900);
      const where = () => cc(() => {
        const a = document.activeElement;
        const layer = a?.closest?.('.panel-layer');
        const top = [...document.querySelectorAll('.panel-layer:not(.closing)')].pop();
        const path = a ? [a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/).slice(0, 2).join('.') : '')] : ['none'];
        return { inside: !!layer && layer === top, body: a === document.body || a === document.documentElement, el: path[0], text: (a?.getAttribute?.('aria-label') || a?.title || a?.textContent || '').trim().slice(0, 40) };
      });
      const outside = [];
      let steps = 0;
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press(i % 2 ? 'Tab' : 'Tab');
        await sleep(25);
        const w = await where();
        steps++;
        if (!w.inside && !w.body) outside.push(w.el + (w.text ? ' "' + w.text + '"' : ''));
        if (outside.length >= 4) break;
      }
      // and backwards
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Shift+Tab');
        await sleep(25);
        const w = await where();
        if (!w.inside && !w.body) outside.push('back: ' + w.el + (w.text ? ' "' + w.text + '"' : ''));
        if (outside.length >= 6) break;
      }
      check(`${name}: Tab and Shift+Tab stay inside the panel`, opened && !outside.length, { steps, outside: outside.slice(0, 6) });
      await cc(() => window.__app.closeAllPanels());
      await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
      await sleep(250);
    }
    await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); clearInterval(window.__buTimer); });
    await sleep(300);
  }

  // ================================================================= lang ===================================================
  if (want('lang')) {
    // the interface in English: no German label, title, placeholder or heading in any panel or in the HUD (book
    // titles, authors and the names of sources are not interface texts and are left out)
    const PANELS = ['menu', 'settings', 'basket', 'records', 'computer', 'catalog', 'news', 'podcasts', 'wiki', 'chess', 'watercolor', 'gallery', 'mediathek', 'browser', 'worldmap', 'audiobooks', 'duplicates', 'search', 'bookinfo', 'reader'];
    const german = /[äöüÄÖÜß]|\b(Schließen|Einstellungen|Suchen|Zurück|Abbrechen|Speichern|Löschen|Öffnen|Weiter|Vorlesen|Lesezeichen|Ordner|Stimme|Anhalten|Wiedergabe|Alle|Neu|Ansicht|Seite|Kapitel|Titel|Autor|Verlag|Jahr|Sprache|Dunkel|Hell|Beenden|Vollbild|Fenster|Lautstärke|Geschwindigkeit|Heute|Gestern|Woche|Monat|Sortieren|Abteilung|Regal|Korb|Lesen|Hören|Spielen|Partie|Zug|Weiß|Schwarz|und|oder|nicht|keine|mit|von|für|zum|zur|des|der|die|das)\b/;
    const collect = (rootSel) => cc((sel) => {
      const root = sel ? [...document.querySelectorAll(sel)].pop() : document;
      if (!root) return null;
      const lib = window.__app.state.library.books;
      const names = new Set();
      for (const b of lib) { if (b.title) names.add(b.title.trim()); if (b.author) names.add(String(b.author).trim()); }
      const out = new Set();
      // a book's title or author inside a label ("Continue reading: Das Buch …") is not interface text either
      const strip = (s) => { for (const n of names) if (n.length > 3 && s.includes(n)) s = s.split(n).join(' '); return s; };
      const add = (s) => { s = (s || '').replace(/\s+/g, ' ').trim(); if (s && s.length < 120 && !names.has(s)) out.add(strip(s).replace(/\s+/g, ' ').trim()); };
      for (const el of root.querySelectorAll('button, [title], [aria-label], [placeholder], h1, h2, h3, h4, label, option, th, summary, .panel-header, .hint, kbd + span')) {
        // content, not interface: programmes of the Mediathek, audiobooks, the hits of the full-text search, the headlines
        // and feed names of the newspaper (an English headline may carry a German name: "… | Klaus Brinkbäumer")
        if (el.closest('webview, .rd-content, .br-view, .news-article, .news-item-title, .news-item-summary, .news-feed-title, .news-kicker, .wiki-article, .pod-desc, .mt-card, .ab-book, .ab-card, .fts-hit, .fts-book-head, .fts-example')) continue;
        // what is not on the screen (the hidden mini player keeps the texts of its last film) does not count
        if (el.tagName !== 'OPTION' && (el.closest('.hidden, [hidden]') || !el.getClientRects().length)) continue;
        add(el.getAttribute('title')); add(el.getAttribute('aria-label')); add(el.getAttribute('placeholder'));
        if (/^(BUTTON|H1|H2|H3|H4|LABEL|OPTION|TH|SUMMARY)$/.test(el.tagName) || el.classList.contains('panel-header')) add(el.textContent);
      }
      return [...out];
    }, rootSel);
    await cc(() => window.__app.ctx.api.settings.set({ language: 'en' }));
    await sleep(800);
    const hud = (await collect('#hud')) || [];
    check('English: the HUD carries no German text', !hud.some((s) => german.test(s)), hud.filter((s) => german.test(s)).slice(0, 8));
    for (const name of PANELS) {
      const params = name === 'reader' || name === 'bookinfo' ? { id: bookId } : name === 'search' ? { q: 'Buch' } : {};
      if ((name === 'reader' || name === 'bookinfo') && !bookId) continue;
      await cc(([n, p]) => window.__app.openPanel(n, p), [name, params]);
      const opened = await waitFor((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n && l.classList.contains('open')), name, 20000);
      await sleep(name === 'reader' || name === 'browser' || name === 'worldmap' ? 2500 : 1200);
      const texts = (await collect('.panel-layer:not(.closing)')) || [];
      const bad = texts.filter((s) => german.test(s));
      check(`English: ${name} carries no German label, title, placeholder or heading (${texts.length} texts)`, opened && !bad.length, bad.slice(0, 10));
      await cc(() => window.__app.closeAllPanels());
      await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
      await sleep(250);
    }
    await cc(() => window.__app.ctx.api.settings.set({ language: 'de' }));
    await sleep(500);
    // the language switched while the panel is open: the panels that can be open at that moment follow (no stale
    // German text). The settings open over the menu and over the audiobooks panel; the computer's system section
    // switches the language itself. The other panels close before the settings can be reached.
    if (want('langlive')) {
      for (const name of ['menu', 'settings', 'computer', 'audiobooks']) {
        const params = name === 'reader' || name === 'bookinfo' ? { id: bookId } : name === 'search' ? { q: 'Buch' } : {};
        if ((name === 'reader' || name === 'bookinfo') && !bookId) continue;
        await cc(([n, p]) => window.__app.openPanel(n, p), [name, params]);
        const opened = await waitFor((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n && l.classList.contains('open')), name, 20000);
        await sleep(name === 'reader' || name === 'browser' || name === 'worldmap' ? 2500 : 1200);
        await cc(() => window.__app.ctx.api.settings.set({ language: 'en' }));
        await sleep(1200);
        const texts = (await collect('.panel-layer:not(.closing)')) || [];
        const bad = texts.filter((s) => german.test(s));
        const still = await cc((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n), name);
        check(`English while open: ${name} follows the switch of the language (${texts.length} texts)`, opened && still && !bad.length, bad.slice(0, 10));
        await cc(() => window.__app.closeAllPanels());
        await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
        await cc(() => window.__app.ctx.api.settings.set({ language: 'de' }));
        await sleep(600);
      }
    }
  }

  // ================================================================= leaks ==================================================
  if (want('leaks')) {
    const cycles = +(process.env.BU_CYCLES || 4);
    await installListen();
    const measure = () => cc(() => {
      const bus = window.__app.ctx.bus;
      const busBy = {}; let busTotal = 0;
      for (const [evt, set] of bus.map) { if (set.size) { busBy[evt] = set.size; busTotal += set.size; } }
      const win = window.__buListen.snapshot();
      const winTotal = Object.values(win).reduce((a, b) => a + b, 0);
      return { bus: busTotal, busBy, win: winTotal, winBy: win, nodes: document.getElementsByTagName('*').length, heap: performance.memory?.usedJSHeapSize || 0, layers: document.querySelectorAll('.panel-layer').length, videos: document.querySelectorAll('video').length, canvases: document.querySelectorAll('canvas').length };
    });
    const PANELS = [
      ['menu', {}], ['settings', {}], ['settings', { section: 'tts' }], ['settings', { section: 'library' }], ['basket', {}], ['bookinfo', { id: bookId }], ['records', {}],
      ['computer', {}], ['computer', { section: 'stats' }], ['catalog', {}], ['news', {}], ['podcasts', {}], ['wiki', {}], ['chess', {}], ['watercolor', {}],
      ['gallery', {}], ['mediathek', {}], ['browser', {}], ['worldmap', {}], ['audiobooks', {}], ['duplicates', {}], ['search', { q: 'Buch' }], ['reader', { id: bookId }],
    ];
    const cycle = async (name, params) => {
      await cc(([n, p]) => window.__app.openPanel(n, p), [name, params]);
      await waitFor((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n && l.classList.contains('open')), name, 20000);
      await sleep(name === 'reader' || name === 'browser' || name === 'worldmap' ? 2500 : 1200);
      await cc(() => window.__app.closeAllPanels());
      // a closing layer leaves the document after its fade (panels.js: at most 6 s for the browser's <webview>s)
      await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
      await sleep(400);
    };
    const growth = {};
    for (const [name, params] of PANELS) {
      if ((name === 'bookinfo' || name === 'reader') && !bookId) continue;
      const rows = [];
      for (let i = 0; i < cycles; i++) {
        await cycle(name, params);
        await gc(); await sleep(200);
        rows.push(await measure());
      }
      const first = rows[1] || rows[0], last = rows[rows.length - 1];
      const dBus = last.bus - first.bus, dWin = last.win - first.win, dNodes = last.nodes - first.nodes;
      const busDiff = Object.fromEntries(Object.entries(last.busBy).filter(([k, v]) => v !== (first.busBy[k] || 0)).map(([k, v]) => [k, v - (first.busBy[k] || 0)]));
      const winDiff = Object.fromEntries(Object.entries(last.winBy).filter(([k, v]) => v !== (first.winBy[k] || 0)).map(([k, v]) => [k, v - (first.winBy[k] || 0)]));
      growth[name + (params.section ? ':' + params.section : '')] = { cycles, dBus, dWin, dNodes, heapMB: +((last.heap - first.heap) / 1048576).toFixed(1), layers: last.layers, videos: last.videos, canvases: last.canvases, busDiff, winDiff };
      const label = name + (params.section ? ' (' + params.section + ')' : '');
      check(`${label}: no bus listener, window or document listener and no DOM node stays behind after ${cycles} open and close cycles`, dBus === 0 && dWin === 0 && dNodes <= 2 && last.layers === 0, growth[name + (params.section ? ':' + params.section : '')]);
    }
    console.log('BU-LEAKS ' + JSON.stringify(growth));
  }

  // ================================================================= layout ===============================================
  if (want('layout')) {
    const sizes = (process.env.BU_SIZES || '1024x640,2560x1440').split(',').map((s) => s.split('x').map(Number));
    const themes = (process.env.BU_THEMES || 'light,sepia,dark').split(',');
    const shotTheme = process.env.BU_SHOT_THEME || 'sepia';
    const PANELS = ['menu', 'settings', 'basket', 'records', 'computer', 'catalog', 'news', 'podcasts', 'wiki', 'chess', 'watercolor', 'gallery', 'mediathek', 'browser', 'worldmap', 'audiobooks', 'duplicates', 'search', 'reader'];
    const theme0 = await cc(() => document.documentElement.dataset.theme);
    for (const [w, hgt] of sizes) {
      await setSize(w, hgt);
      await sleep(600);
      for (const theme of themes) {
        await cc((t) => window.api.settings.set({ ui: { theme: t } }), theme);
        await sleep(300);
        for (const name of PANELS) {
          const params = name === 'reader' ? { id: bookId } : name === 'search' ? { q: 'Buch' } : {};
          if (name === 'reader' && !bookId) continue;
          const before = errors.length;
          await cc(([n, p]) => window.__app.openPanel(n, p), [name, params]);
          const opened = await waitFor((n) => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === n && l.classList.contains('open')), name, 20000);
          await sleep(name === 'reader' || name === 'browser' || name === 'worldmap' ? 2500 : 1100);
          const r = await cc((n) => {
            const layer = [...document.querySelectorAll('.panel-layer:not(.closing)')].find((l) => l.dataset.panel === n);
            const panel = layer?.querySelector('.panel, .menu-root, .rd-root, .wm-panel');
            if (!panel) return { found: false };
            const b = panel.getBoundingClientRect();
            const vw = innerWidth, vh = innerHeight;
            const fits = b.left >= -1 && b.top >= -1 && b.right <= vw + 1 && b.bottom <= vh + 1;
            const pageScroll = document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1;
            // the header's controls stay inside the panel (long titles, many buttons in a narrow window)
            const head = panel.querySelector('.panel-header, .mt-header, .term-header, .wm-head, .br-bar, .rd-top, .ab-header, .pod-header, .news-masthead, .wiki-header, .cat-header, .chess-header');
            let headOut = [];
            if (head) {
              for (const el of head.querySelectorAll('button, input, select')) {
                const r2 = el.getBoundingClientRect();
                if (r2.width && r2.height && (r2.right > b.right + 1 || r2.left < b.left - 1 || r2.bottom > b.bottom + 1 || r2.top < b.top - 1)) headOut.push((el.getAttribute('aria-label') || el.title || el.textContent || el.className).trim().slice(0, 30));
              }
            }
            // text that is clipped in the header (a title cut off in the middle of a word is fine when it ellipses)
            return { found: true, fits, pageScroll, headOut, w: Math.round(b.width), h: Math.round(b.height), vw, vh };
          }, name);
          const newErrors = errors.slice(before);
          check(`${w}×${hgt} ${theme} ${name}: opens, fits the window, no sideways page scroll, header controls inside, no error`, opened && r.found && r.fits && !r.pageScroll && !r.headOut.length && !newErrors.length, { ...r, errors: newErrors.slice(0, 3) });
          if (theme === shotTheme && shots && (w !== 2560 || name === 'reader' || name === 'mediathek')) await pic(`bu-layout-${w}-${theme}-${name}`);
          await cc(() => window.__app.closeAllPanels());
          await waitFor(() => !document.querySelector('.panel-layer'), null, 9000);
          await sleep(250);
        }
      }
    }
    await cc((t) => window.api.settings.set({ ui: { theme: t } }), theme0 || 'sepia');
    await setSize(1600, 960);
  }

  // ---- summary ------------------------------------------------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  check('no renderer errors during the check', errors.length === 0, errors.slice(0, 8));
  console.log(`\nSUMMARY ${results.length - failed.length - (errors.length ? 1 : 0)}/${results.length} passed` + (failed.length ? '\nFAILED: ' + failed.map((r) => r.name).join(' | ') : ''));
};
