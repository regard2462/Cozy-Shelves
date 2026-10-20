// The department wheel (Tab) and its second ring, the places (0.7.2):
//   1. opening: the departments ring, the current department highlighted, the centre pill says "Orte" with the
//      key Q, the hint names the places; Esc closes
//   2. the centre disc: the cursor out in the ring and back into the centre swaps to the places (every place of
//      world.places, group by group as the places tab of the menu lists them, nothing highlighted, the pill says
//      "Abteilungen"), out again highlights a place with its group as the second line, the centre once more brings
//      the departments back; Tab let go over the centre closes the wheel and nobody moves
//   3. picking a place: Tab let go over a place, a click on one (the wheel opened from the HUD chip), Enter after the
//      arrow keys and a digit teleport exactly as the places tab does (the player stands at the place, facing as it
//      says)
//   4. the keys: a Tab tap keeps the wheel open, Q swaps the rings, a held Q (repeat) does not swap again, the mouse
//      wheel steps, Esc closes
//   5. the pad: View held opens the wheel, LB or RB swap the rings, the pill and the hint show the pad's glyphs, a
//      stick points at a place, letting go of View teleports there, B closes
//   6. legibility: every label of the places ring inside its sector, type 11 px and more, German and English
//   7. English: "Places" and "Departments", the hint names the places, the places carry their English names
//   8. pictures of both rings in the three appearances at 1600 × 900 and 2560 × 1440
// Runs muted and hidden like every harness script; it waits for events, never for a number of frames.
//   node build/screenshot.js wheel-check   (COZYSHELVES_BOOKS with a few departments, e.g. testbooks4;
//                                           WHEEL_PARTS=open,centre,pick,keys,pad,fit,english,shots)
module.exports = async ({ app, page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = async (fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const parts = (process.env.WHEEL_PARTS || 'open,centre,pick,keys,pad,fit,english,shots').split(',');
  const want = (p) => parts.includes(p);
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win.setContentSize(w, h); }, [w, h]);

  // ---- boot -------------------------------------------------------------------------------------------------------
  await setSize(1600, 900);
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await cc(() => document.querySelector('.menu-btn.primary').click());
  // the scan settles: every department exists
  await waitFor(() => { const l = window.__app.state.library; return l.books.length > 0 && !l.scan?.active && !document.querySelector('#scan-status')?.textContent; }, null, 240000);
  await waitFor(() => window.__app.state.entered && !!window.__app.pad?.wheel, null, 30000);
  await cc(() => window.__app.closeAllPanels());

  // ---- helpers inside the page -------------------------------------------------------------------------------------
  await cc(() => {
    const w = window.__app.world;
    window.__wc = {
      wheel: () => window.__app.pad.wheel,
      /** the wheel as it is seen: ring, sectors, the highlighted one, the centre's texts, the labels */
      state() {
        const el = document.querySelector('#wheel'), wh = this.wheel();
        const sectors = [...el.querySelectorAll('.wheel-sector')];
        return {
          open: !el.classList.contains('hidden'), ring: el.dataset.ring || null, n: sectors.length,
          active: sectors.findIndex((s) => s.classList.contains('active')), index: wh.index,
          title: el.querySelector('.wheel-title')?.textContent || '', count: el.querySelector('.wheel-count')?.textContent || '',
          pill: (el.querySelector('.wheel-switch')?.textContent || '').replace(/\s+/g, ' ').trim(), pillActive: !!el.querySelector('.wheel-switch.active'),
          pillPad: el.querySelectorAll('.wheel-switch kbd.pad').length, hint: el.querySelector('.wheel-hint')?.innerHTML || '',
          labels: [...el.querySelectorAll('.wheel-label')].map((l) => [...l.querySelectorAll('tspan')].map((s) => s.textContent).join(' ')),
          items: (wh.items || []).map((i) => ({ kind: i.kind, id: i.id ?? i.name ?? i.kind, label: i.label, group: i.group ?? null })),
        };
      },
      /** where a sector's middle is on the screen (r: how far out between the disc and the rim), or the centre */
      at(idx, r = 0.55) {
        const b = document.querySelector('.wheel-svg').getBoundingClientRect(), k = b.width / 520;
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        if (idx == null) return { x: cx, y: cy };
        const n = document.querySelectorAll('.wheel-sector').length, a = (-90 + idx * 360 / n) * Math.PI / 180, rr = (96 + 134 * r) * k;
        return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
      },
      /** the labels of the ring shown against their sectors (SVG units) */
      fit() {
        const labels = [...document.querySelectorAll('.wheel-label')], n = labels.length, dense = n >= 13;
        const rr = 96 + 134 * (dense ? 0.6 : 0.5), maxW = 2 * rr * Math.sin(Math.PI / n) - (dense ? 10 : 16);
        const widths = labels.map((l) => l.getBBox().width), sizes = labels.map((l) => parseFloat(l.style.fontSize));
        return { n, maxW: +maxW.toFixed(1), widest: +Math.max(...widths).toFixed(1), minSize: Math.min(...sizes), maxLines: Math.max(...labels.map((l) => l.querySelectorAll('tspan').length)),
          labels: labels.map((l) => [...l.querySelectorAll('tspan')].map((s) => s.textContent).join('/') + '@' + l.style.fontSize) };
      },
      places() { return (w.places || []).map((p) => ({ id: p.id, group: p.group, x: p.x, z: p.z, yaw: p.yaw, label: p.label })); },
      player() { const p = w.player; return { x: +p.position.x.toFixed(2), z: +p.position.z.toFixed(2), yaw: +p.yaw.toFixed(2), enabled: p.enabled }; },
      /** the player stands at the place and faces as it says (the teleport fades for about half a second first) */
      atPlace(id) { const p = w.player, pl = w.places.find((x) => x.id === id); return !!pl && Math.hypot(p.position.x - pl.x, p.position.z - pl.z) < 0.05 && Math.abs(Math.atan2(Math.sin(p.yaw - pl.yaw), Math.cos(p.yaw - pl.yaw))) < 0.01; },
      stand(id) { return w.actions.teleport(id); },
      hidden() { return document.querySelector('#wheel').classList.contains('hidden'); },
    };
  });
  const state = () => cc(() => window.__wc.state());
  const moveTo = async (idx, r) => { const p = await cc(([i, r]) => window.__wc.at(i, r), [idx, r ?? 0.55]); await page.mouse.move(p.x, p.y); return p; };
  const opened = () => waitFor(() => !window.__wc.hidden(), null, 5000);
  const closed = () => waitFor(() => window.__wc.hidden(), null, 5000);
  const openByTab = async () => { await page.keyboard.down('Tab'); return opened(); };
  /** out of the centre onto sector 0, back into the centre: the places ring */
  const toPlaces = async () => { await moveTo(0); await waitFor(() => window.__wc.state().active === 0); await moveTo(null); return waitFor(() => window.__wc.state().ring === 'places'); };
  const places = await cc(() => window.__wc.places());
  const order = ['hall', 'entrance', 'rooms', 'garden'];
  const expectIds = [...order.flatMap((g) => places.filter((p) => p.group === g)), ...places.filter((p) => !order.includes(p.group))].map((p) => p.id);
  console.log('PLACES ' + JSON.stringify(expectIds));
  // a stable start: the middle of the hall, the mouse in the middle of the window
  await cc(() => window.__wc.stand('hall'));
  await page.mouse.move(800, 450);

  // ---- 1. opening ---------------------------------------------------------------------------------------------------
  if (want('open')) {
    const cur = await cc(() => window.__app.state.department);
    const ok = await openByTab();
    const s = await state();
    check('Tab opens the departments ring: the current department highlighted, the centre pill says "Orte" with the key Q, the hint names the places',
      ok && s.ring === 'deps' && s.items[s.active]?.kind === 'dep' && (cur ? s.items[s.active]?.label === cur : s.active === 0) && /Orte/.test(s.pill) && /Q/.test(s.pill) && !s.pillActive && /Orte/.test(s.hint) && /Tab/.test(s.hint),
      { ok, ring: s.ring, active: s.active, cur, pill: s.pill, title: s.title, count: s.count, hint: s.hint.slice(0, 120) });
    await page.keyboard.press('Escape');
    const shut = await closed();
    await page.keyboard.up('Tab');
    check('Esc closes the wheel', shut);
  }

  // ---- 2. the centre disc ---------------------------------------------------------------------------------------------
  if (want('centre')) {
    await openByTab();
    await moveTo(0);
    const s1ok = await waitFor(() => { const s = window.__wc.state(); return s.active === 0 && s.ring === 'deps'; });
    check('the cursor out in the ring highlights the sector under it (the departments stay)', s1ok, { active: (await state()).active });
    await moveTo(null);
    const swapped = await waitFor(() => window.__wc.state().ring === 'places');
    const s2 = await state();
    check('back into the centre: the places ring, every place of world.places in the order of the places tab, nothing highlighted, the pill says "Abteilungen"',
      swapped && s2.n === places.length && JSON.stringify(s2.items.map((i) => i.id)) === JSON.stringify(expectIds) && s2.active === -1 && s2.pillActive && /Abteilungen/.test(s2.pill) && s2.title === 'Orte' && s2.count === `${places.length} Orte` && /Abteilungen/.test(s2.hint),
      { swapped, n: s2.n, ids: s2.items.map((i) => i.id), active: s2.active, pill: s2.pill, title: s2.title, count: s2.count });
    const k = s2.items.findIndex((i) => i.id === 'jetty');
    await moveTo(k);
    const picked = await waitFor((k) => window.__wc.state().active === k, k);
    const s3 = await state();
    const jetty = places.find((p) => p.id === 'jetty');
    check('out again over "Steg am See": highlighted, the centre names it and its group "Garten"', picked && s3.ring === 'places' && s3.title === jetty.label.de && s3.count === 'Garten' && !s3.pillActive, { picked, title: s3.title, count: s3.count });
    await moveTo(null);
    const back = await waitFor(() => window.__wc.state().ring === 'deps');
    const s4 = await state();
    check('the centre once more: the departments again, nothing highlighted, the pill says "Orte"', back && s4.active === -1 && /Orte/.test(s4.pill) && s4.title === 'Abteilungen' && /Abteilungen$/.test(s4.count), { back, active: s4.active, pill: s4.pill, title: s4.title, count: s4.count });
    const before = await cc(() => window.__wc.player());
    await page.keyboard.up('Tab');
    const shut = await closed();
    await sleep(900);   // a teleport would fade for 0.46 s first: none may come
    const after = await cc(() => window.__wc.player());
    check('Tab let go over the centre closes the wheel and nobody moves', shut && before.x === after.x && before.z === after.z && after.enabled, { before, after });
  }

  // ---- 3. picking a place ---------------------------------------------------------------------------------------------
  if (want('pick')) {
    // Tab let go over a place
    await openByTab(); await toPlaces();
    let items = (await state()).items;
    let k = items.findIndex((i) => i.id === 'terrace');
    await moveTo(k); await waitFor((k) => window.__wc.state().active === k, k);
    await page.keyboard.up('Tab');
    const t1 = await waitFor(() => window.__wc.atPlace('terrace'), null, 5000);
    check('Tab let go over "Terrasse" teleports there as the places tab does (the player stands at the place, facing as it says), the wheel closes', t1 && await closed(), { t1, player: await cc(() => window.__wc.player()), place: places.find((p) => p.id === 'terrace') });
    // a click on a place (the wheel opened from the HUD chip, a free cursor)
    await cc(() => window.__app.ctx.openWheel()); await opened(); await toPlaces();
    items = (await state()).items; k = items.findIndex((i) => i.id === 'fireside');
    const pk = await moveTo(k); await waitFor((k) => window.__wc.state().active === k, k);
    await page.mouse.click(pk.x, pk.y);
    const t2 = await waitFor(() => window.__wc.atPlace('fireside'), null, 5000);
    check('a click on "Kamin" teleports there', t2 && await closed(), { t2, player: await cc(() => window.__wc.player()) });
    // the keyboard alone: a Tab tap, Q, the arrows, Enter
    await page.mouse.move(800, 450);
    await page.keyboard.press('Tab');
    const stay = await opened();
    await page.keyboard.press('q');
    await waitFor(() => window.__wc.state().ring === 'places');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const s = await state();
    await page.keyboard.press('Enter');
    const t3 = await waitFor((id) => window.__wc.atPlace(id), expectIds[1], 5000);
    check('a Tab tap keeps the wheel open, Q shows the places, the arrows step from the first place, Enter teleports', stay && s.active === 1 && t3, { stay, active: s.active, id: expectIds[1], t3 });
    // a digit
    await page.keyboard.press('Tab'); await opened();
    await page.keyboard.press('q'); await waitFor(() => window.__wc.state().ring === 'places');
    await page.keyboard.press('4');
    const t4 = await waitFor((id) => window.__wc.atPlace(id), expectIds[3], 5000);
    check('a digit picks the place with that number', t4 && await closed(), { id: expectIds[3], t4 });
  }

  // ---- 4. the keys ----------------------------------------------------------------------------------------------------
  if (want('keys')) {
    await cc(() => window.__wc.stand('hall'));
    await page.keyboard.press('Tab'); await opened();
    await page.keyboard.down('q');
    const a = await waitFor(() => window.__wc.state().ring === 'places');
    await page.keyboard.down('q');   // the key held: a repeat, no second swap
    await sleep(150);
    const s1 = await state();
    await page.keyboard.up('q');
    await page.keyboard.press('q');
    const b = await waitFor(() => window.__wc.state().ring === 'deps');
    check('Q swaps the rings, a held Q (repeat) does not swap again, Q once more brings the departments back', a && s1.ring === 'places' && s1.active === -1 && b, { a, ring: s1.ring, active: s1.active, b });
    await page.mouse.wheel(0, 120);
    const st = await waitFor(() => window.__wc.state().active === 0);
    check('the mouse wheel steps to the first sector after a swap', st, { active: (await state()).active });
    // how long a swap takes (the ring is drawn anew): for the record
    const swapMs = await cc(() => { const wh = window.__wc.wheel(); const t0 = performance.now(); wh.toggleRing(); const a = performance.now() - t0; wh.toggleRing(); return { toPlaces: +a.toFixed(2), back: +(performance.now() - t0 - a).toFixed(2) }; });
    console.log('SWAP-MS ' + JSON.stringify(swapMs));
    await page.keyboard.press('Escape');
    check('Esc closes the wheel', await closed());
  }

  // ---- 5. the pad -----------------------------------------------------------------------------------------------------
  if (want('pad')) {
    await cc(() => {
      const IDX = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16 };
      const mk = (id) => ({ id, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) });
      const P = window.__app.pad;
      window.__fp = {
        pad: mk('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'),
        connect() { Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [this.pad, null, null, null] }); const e = new Event('gamepadconnected'); e.gamepad = this.pad; window.dispatchEvent(e); },
        disconnect() { this.pad.connected = false; Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); const e = new Event('gamepaddisconnected'); e.gamepad = this.pad; window.dispatchEvent(e); },
        set(name, on) { const b = this.pad.buttons[IDX[name]]; b.pressed = !!on; b.value = on ? 1 : 0; this.pad.timestamp++; },
        axes(lx = 0, ly = 0, rx = 0, ry = 0) { this.pad.axes = [lx, ly, rx, ry]; this.pad.timestamp++; },
        step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) P.step(dt); },
        tap(name) { this.set(name, true); this.step(); this.set(name, false); this.step(); },
        /** View held until the wheel opens (0.32 s), two seconds at most */
        holdView() { this.set('view', true); for (let i = 0; i < 120 && window.__wc.hidden(); i++) this.step(); return !window.__wc.hidden(); },
      };
    });
    await cc(() => window.__fp.connect());
    const loop = await waitFor(() => window.__app.pad.count === 1 && !!window.__app.pad.raf);
    await cc(() => { window.__app.pad.paused = true; });
    const pad1 = await cc(() => {
      const f = window.__fp, S = window.__wc;
      f.tap('l3'); f.tap('l3');          // the first press wakes the pad (run on and off again)
      const opened = f.holdView();
      const a = S.state();
      f.tap('rb');
      const b = S.state();
      f.axes(0, 0, 1, 0); f.step(2);     // the right stick to the right: the sector in the east
      const c = S.state();
      const n = c.n, east = Math.floor(n / 4 + 0.5) % n, target = c.items[east]?.id || null;
      f.axes(0, 0, 0, 0); f.set('view', false); f.step(2);
      return { opened, a: { ring: a.ring, pillPad: a.pillPad, pill: a.pill }, b: { ring: b.ring, pillPad: b.pillPad, active: b.active, pill: b.pill, hintPad: /kbd class="pad/.test(b.hint), hint: b.hint.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }, c: { active: c.active, east, target }, closed: S.hidden() };
    });
    const tp = pad1.c.target ? await waitFor((id) => window.__wc.atPlace(id), pad1.c.target, 5000) : false;
    check('the pad: View held opens the departments ring with the pad\'s glyphs in the pill, RB swaps to the places (nothing highlighted, the hint names the departments with the glyphs), the right stick points at a place, letting go of View teleports there',
      loop && pad1.opened && pad1.a.ring === 'deps' && pad1.a.pillPad === 2 && pad1.b.ring === 'places' && pad1.b.active === -1 && pad1.b.pillPad === 2 && pad1.b.hintPad && /Abteilungen/.test(pad1.b.hint) && pad1.c.active === pad1.c.east && pad1.closed && tp, { loop, ...pad1, tp });
    const pad2 = await cc(() => {
      const f = window.__fp, S = window.__wc;
      const opened = f.holdView();
      f.tap('lb'); const a = S.state();
      f.tap('lb'); const b = S.state();
      f.tap('b'); const closed = S.hidden();
      f.set('view', false); f.step(2);
      return { opened, a: a.ring, b: b.ring, closed, panels: [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel) };
    });
    check('LB swaps too (and back), B closes the wheel, letting go of View then opens nothing', pad2.opened && pad2.a === 'places' && pad2.b === 'deps' && pad2.closed && pad2.panels.length === 0, pad2);
    await cc(() => { window.__fp.disconnect(); window.__app.pad.paused = false; });
    await page.mouse.move(790, 450); await page.mouse.move(800, 450);
    const keys = await waitFor(() => document.documentElement.dataset.input !== 'pad');
    check('the keys and the mouse take over again after the pad', keys, { input: await cc(() => document.documentElement.dataset.input || null) });
  }

  // ---- 6. legibility --------------------------------------------------------------------------------------------------
  const fitCheck = async (lang) => {
    await cc(() => window.__app.ctx.openWheel()); await opened(); await toPlaces();
    const f = await cc(() => window.__wc.fit());
    console.log('FIT ' + lang + ' ' + JSON.stringify(f));
    check(`${lang}: every label of the places ring inside its sector, type 11 px and more, three lines at most`, f.widest <= f.maxW + 1 && f.minSize >= 11 && f.maxLines <= 3, { n: f.n, maxW: f.maxW, widest: f.widest, minSize: f.minSize, maxLines: f.maxLines });
    await page.keyboard.press('Escape'); await closed();
  };
  if (want('fit')) await fitCheck('de');

  // ---- 7. English -----------------------------------------------------------------------------------------------------
  if (want('english')) {
    await cc(() => window.api.settings.set({ language: 'en' }));
    const en = await waitFor(() => document.documentElement.lang === 'en');
    await page.keyboard.press('Tab'); await opened();
    const a = await state();
    await page.keyboard.press('q'); await waitFor(() => window.__wc.state().ring === 'places');
    const b = await state();
    const terrace = places.find((p) => p.id === 'terrace');
    check('English: the pill says "Places" and "Departments", the hint names the places, the places carry their English names',
      en && /Places/.test(a.pill) && /places/.test(a.hint) && /Departments/.test(b.pill) && /departments/.test(b.hint) && b.title === 'Places' && b.items.some((i) => i.label === terrace.label.en),
      { en, pillA: a.pill, pillB: b.pill, title: b.title, count: b.count, hint: a.hint.slice(0, 100) });
    await page.keyboard.press('Escape'); await closed();
    if (want('fit')) await fitCheck('en');
    await cc(() => window.api.settings.set({ language: 'de' }));
    await waitFor(() => document.documentElement.lang === 'de');
  }

  // ---- 8. pictures ----------------------------------------------------------------------------------------------------
  if (want('shots')) {
    await cc(() => window.__wc.stand('hall'));
    const theme0 = await cc(() => document.documentElement.dataset.theme || 'sepia');
    for (const [w, hgt] of [[1600, 900], [2560, 1440]]) {
      await setSize(w, hgt);
      await waitFor(([w, h]) => Math.abs(window.innerWidth - w) < 4 && Math.abs(window.innerHeight - h) < 4, [w, hgt]);
      await cc(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      for (const theme of ['light', 'sepia', 'dark']) {
        await cc((t) => window.api.settings.set({ ui: { theme: t } }), theme);
        await waitFor((t) => document.documentElement.dataset.theme === t, theme);
        await page.mouse.move(w / 2, hgt / 2);
        await cc(() => window.__app.ctx.openWheel()); await opened();
        await moveTo(1); await waitFor(() => window.__wc.state().active === 1);
        await shot(`wheel-${theme}-deps-${w}`);
        await moveTo(null); await waitFor(() => window.__wc.state().ring === 'places');
        if (theme === 'sepia') await shot(`wheel-${theme}-places-centre-${w}`);
        const k = Math.floor((await state()).n * 0.3);
        await moveTo(k); await waitFor((k) => window.__wc.state().active === k, k);
        await shot(`wheel-${theme}-places-${w}`);
        await page.keyboard.press('Escape'); await closed();
      }
    }
    await cc((t) => window.api.settings.set({ ui: { theme: t } }), theme0);
    await setSize(1600, 900);
  }

  await cc(() => window.__app.closeAllPanels());
  check('no renderer errors', errors.length === 0, errors.slice(0, 5));
  const pass = results.filter((r) => r.ok).length;
  console.log(`SUMMARY wheel-check: ${pass}/${results.length} passed${pass < results.length ? ', FAILED: ' + results.filter((r) => !r.ok).map((r) => r.name).join(' | ') : ''}`);
};
