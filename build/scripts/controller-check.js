// The gamepad (app/src/input/*): a scripted pad with the standard mapping stands in for a real one (navigator.
// getGamepads is replaced in the page, 'gamepadconnected' is sent by hand).
//   1. no pad: nothing polls (no getGamepads call, no frame loop)
//   2. the pad connects: the loop starts, its name and family
//   3. the world: the left stick walks like W (half tilt half the speed), the right stick looks (sensitivity, invert
//      Y, curve), the triggers zoom and aim finely; every button: A takes a book (and rumbles), LB reads, RB shows the
//      info, X jumps, Y opens the basket, B and the right stick stand up, the right stick sits down, the left stick
//      runs and stands up, Start opens the menu, View the places (held: the department wheel), the D-pad steps from
//      book to book and seeks a podcast
//   4. the hints: the pad's buttons while it is used, the keys again after a real key or mouse movement
//   5. the menu: the ring moves, A presses, LB/RB switch the tabs, B closes
//   6. Einstellungen → Controller: connection, picture, sensitivity, invert Y, vibration
//   7. the reader: LB/RB and the D-pad turn the page, A shows the bars, B back to the page, X bookmarks, Y reads aloud
//   8. the Mediathek film: A pause and play, ◀▶ seek, B closes; the mini player (D-pad down); the film in full screen
//   9. the world map: the stick moves the map, RT zooms, the cross shows the name under it, A opens the card under the
//      cross; the keyboard on the screen (the map's tiles come from build/scripts/osm-tiles.js, never from OpenStreetMap)
//  10. a game on the computer: the D-pad is the arrow keys; 10b. the pointer (R3) plays a move on the chess board with
//      real mouse input, keeps the pad's hints, turns the wheel, B ends it
//  11. PlayStation glyphs; 11b. the list of buttons in the settings, English; 12. in the running loop; 13. disconnect:
//      the loop stops, the keys come back
// Runs muted and hidden like every harness script (COZYSHELVES_BOOKS with an EPUB, e.g. testbooks4).
//   node build/screenshot.js controller-check    (CC_PARTS=world,hints,menu,settings,reader,media,map,computer,pointer,podcasts,panels,ps,english,live)
const { serveTiles } = require('./osm-tiles.js');

module.exports = async ({ app, page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const cc = (fn, arg) => page.evaluate(fn, arg);
  const parts = (process.env.CC_PARTS || 'world,hints,menu,settings,reader,media,map,computer,pointer,podcasts,panels,ps,english,live').split(',');
  const want = (p) => parts.includes(p);

  // ---- 1. no pad, from the start --------------------------------------------------------------------------------
  // count the calls of the real getGamepads from the first moment the page can be reached
  await page.waitForFunction(() => !!window.__app?.pad, null, { timeout: 240000 });
  await cc(() => {
    const orig = navigator.getGamepads.bind(navigator);
    window.__nativeCalls = 0;
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { window.__nativeCalls++; return orig(); } });
  });
  await page.waitForFunction(() => document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await cc(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 45; i++) {
    const st = await cc(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active, hud: document.querySelector('#scan-status')?.textContent || '' }));
    if (!st.active && !st.hud && st.n > 0) break;
    await sleep(2000);
  }
  await sleep(1500);
  const idle0 = await cc(() => ({ calls: window.__nativeCalls, raf: window.__app.pad.raf, input: document.documentElement.dataset.input || null }));
  await sleep(3000);
  const idle1 = await cc(() => ({ calls: window.__nativeCalls, raf: window.__app.pad.raf, input: document.documentElement.dataset.input || null, count: window.__app.pad.count }));
  check('no pad: nothing polls (no getGamepads call in 3 s of the world, no frame loop of its own)', idle1.calls === idle0.calls && idle1.calls === 0 && !idle1.raf && !idle1.count && idle1.input === null, { idle0, idle1 });

  // ---- the scripted pad -----------------------------------------------------------------------------------------
  await cc(() => {
    const IDX = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, home: 16 };
    const fx = [];
    const mk = (id) => ({
      id, index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: { type: 'dual-rumble', effects: ['dual-rumble'], playEffect: (type, p) => { fx.push({ type, ...p }); return Promise.resolve('complete'); }, reset: () => Promise.resolve('complete') },
    });
    const w = window.__app.world, P = window.__app.pad;
    window.__fp = {
      IDX, fx, pad: mk('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), calls: 0,
      connect(id) {
        if (id) this.pad = mk(id);
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { this.calls++; return [this.pad, null, null, null]; } });
        const e = new Event('gamepadconnected'); e.gamepad = this.pad; window.dispatchEvent(e);
      },
      disconnect() {
        this.pad.connected = false;
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => { this.calls++; return [null, null, null, null]; } });
        const e = new Event('gamepaddisconnected'); e.gamepad = this.pad; window.dispatchEvent(e);
      },
      set(name, on, value) { const b = this.pad.buttons[IDX[name]]; b.pressed = !!on; b.value = value ?? (on ? 1 : 0); this.pad.timestamp++; },
      axes(lx = 0, ly = 0, rx = 0, ry = 0) { this.pad.axes = [lx, ly, rx, ry]; this.pad.timestamp++; },
      release() { for (const b of this.pad.buttons) { b.pressed = false; b.value = 0; } this.pad.axes = [0, 0, 0, 0]; },
      /** one poll of the pad, then the world's own steps (the world loop rests in this check) */
      step(n = 1, dt = 1 / 60, world = true) { for (let i = 0; i < n; i++) { P.step(dt); if (world) { w.player.update(dt); w.actions.rayTimer = 0; w.actions.update(dt); } } },
      tap(name, world = true) { this.set(name, true); this.step(1, 1 / 60, world); this.set(name, false); this.step(1, 1 / 60, world); },
      panels() { return [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel); },
      /** the ring: shown or not (it fades in), and the element it rests on (the ring glides there in 0.12 s) */
      ring() {
        const r = document.querySelector('#pad-ring'); const el = P.nav.el; const b = el?.getBoundingClientRect();
        return { show: r.classList.contains('show'), x: b ? Math.round(b.left) : null, y: b ? Math.round(b.top) : null, w: b ? Math.round(b.width) : null, h: b ? Math.round(b.height) : null,
          on: el ? (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40) : null, tag: el?.tagName || null };
      },
      aim(x, z, tx, ty, tz) {
        const p = w.player;
        if (w.actions.seatedId || p.seated) w.actions.leaveSeat();
        p.transition = null;
        p.setPose(x, z, Math.atan2(-(tx - x), -(tz - z)), Math.atan2(ty - 1.62, Math.hypot(tx - x, tz - z)));
        return this.look();
      },
      look() { const p = w.player; p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); const t = w.actions.target; return t ? { type: t.type, kind: t.kind || null, book: t.book?.id || t.id || null, seat: t.seat?.id || null, near: t.near ?? null } : null; },
      /** a book on a shelf at eye height (with a cover if there is one), not in the basket */
      book() {
        const all = [...w.books.entries.values()].filter((x) => !x.hidden && !w.actions.basket.includes(x.book.id));
        return all.find((x) => x.pos.y > 1.0 && x.pos.y < 1.8 && x.book.hasCover !== false) || all.find((x) => x.pos.y > 0.9 && x.pos.y < 1.9) || all[0] || null;
      },
      aimBook(e) { w.actions.goToBook(e.book.id); return this.look(); },
    };
  });
  const fp = (fn, arg) => page.evaluate(fn, arg);

  await cc(() => window.__fp.connect());
  await sleep(500);
  const conn = await cc(() => ({ raf: !!window.__app.pad.raf, count: window.__app.pad.count, calls: window.__fp.calls }));
  check('the pad connects: its loop runs and polls', conn.raf && conn.count === 1 && conn.calls > 3, conn);
  // from here on the check steps the pad itself
  await cc(() => { window.__app.pad.paused = true; window.__app.world.stop(); window.__app.closeAllPanels(); });
  await sleep(600);
  await cc(() => { const a = window.__app.world.actions; if (a.basket.length) { a.returnAll(); for (let i = 0; i < 40; i++) a.update(0.05); } });

  // ================================================================= 3. the world =================================================
  if (want('world')) {
    // the first touch wakes the pad: the hints switch, the html carries data-input="pad"
    const woke = await fp(() => { const f = window.__fp; f.aim(-0.8, 1.4, -0.8, 1.62, -3); f.tap('l3'); f.tap('l3'); return { input: document.documentElement.dataset.input || null }; });
    check('the first press makes the pad the input used last (data-input="pad")', woke.input === 'pad', woke);

    // walking: the left stick forward for one second like W, half tilt about half as far
    const walk = await fp(() => {
      const f = window.__fp, w = window.__app.world, p = w.player;
      const run = (fn) => { f.aim(-0.8, 3.2, -0.8, 1.62, -3); const z0 = p.position.z, x0 = p.position.x; fn(true); f.step(60); fn(false); f.step(30); return { dz: +(z0 - p.position.z).toFixed(3), dx: +(p.position.x - x0).toFixed(3) }; };
      const keys = run((on) => document.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: 'KeyW', key: 'w', bubbles: true })));
      const full = run((on) => f.axes(0, on ? -1 : 0));
      const half = run((on) => f.axes(0, on ? -0.575 : 0));     // half way out of the dead zone
      const side = run((on) => f.axes(on ? 1 : 0, 0));
      return { keys, full, half, side };
    });
    check('left stick forward walks like W (within 5 %)', walk.full.dz > 1.5 && Math.abs(walk.full.dz - walk.keys.dz) / walk.keys.dz < 0.05 && Math.abs(walk.full.dx) < 0.02, walk);
    check('half tilt walks about half as fast (40 to 60 %)', walk.half.dz / walk.full.dz > 0.4 && walk.half.dz / walk.full.dz < 0.6, { half: walk.half.dz, full: walk.full.dz });
    check('left stick to the right strafes to the right', walk.side.dx > 1.5 && Math.abs(walk.side.dz) < 0.05, walk.side);
    // run: the left stick pressed (L3), until the stick rests
    const run = await fp(() => {
      const f = window.__fp, p = window.__app.world.player;
      f.aim(-0.8, 3.2, -0.8, 1.62, -3);
      const z0 = p.position.z;
      f.axes(0, -1); f.step(2); f.set('l3', true); f.step(1); f.set('l3', false); f.step(57);
      const ran = z0 - p.position.z;
      f.axes(0, 0); f.step(40);
      const after = !!window.__app.pad.run;
      return { ran: +ran.toFixed(2), runAfterRest: after };
    });
    check('the left stick pressed runs (faster than walking), resting the stick ends it', run.ran > walk.full.dz * 1.4 && !run.runAfterRest, { ...run, walk: walk.full.dz });

    // looking: the right stick turns, sensitivity and invert Y, the curve
    const look = await fp(async () => {
      const f = window.__fp, w = window.__app.world, p = w.player, api = window.__app.ctx.api;
      const turn = (rx, ry, frames = 30) => { f.aim(-0.8, 1.4, -0.8, 1.62, -3); p.pitch = 0; const y0 = p.yaw, q0 = p.pitch; f.axes(0, 0, rx, ry); f.step(frames); f.axes(0, 0, 0, 0); f.step(40); return { yaw: +(p.yaw - y0).toFixed(4), pitch: +(p.pitch - q0).toFixed(4) }; };
      const full = turn(1, 0), small = turn(0.35, 0), down = turn(0, 0.8), dead = turn(0.1, 0.1);
      await api.settings.set({ gamepad: { sensitivity: 2 } }); await new Promise((r) => setTimeout(r, 300));
      const fast = turn(1, 0);
      await api.settings.set({ gamepad: { sensitivity: 1, invertY: true } }); await new Promise((r) => setTimeout(r, 300));
      const inv = turn(0, 0.8);
      await api.settings.set({ gamepad: { invertY: false } }); await new Promise((r) => setTimeout(r, 300));
      return { full, small, down, dead, fast, inv };
    });
    check('right stick to the right turns right (yaw falls), down looks down', look.full.yaw < -0.5 && look.down.pitch < -0.3, look);
    check('a small tilt turns much slower than full tilt (curve), the dead zone does nothing', Math.abs(look.small.yaw) < Math.abs(look.full.yaw) * 0.3 && look.dead.yaw === 0 && look.dead.pitch === 0, look);
    check('sensitivity 2 turns about twice as fast', look.fast.yaw / look.full.yaw > 1.8 && look.fast.yaw / look.full.yaw < 2.2, { full: look.full.yaw, fast: look.fast.yaw });
    check('"Y invertieren": the same stick looks up', look.inv.pitch > 0.3 && Math.abs(look.inv.pitch + look.down.pitch) < 0.05, { normal: look.down.pitch, inverted: look.inv.pitch });
    // the triggers: RT zooms in (narrower field of view), LT aims finely (slower turning)
    const trig = await fp(() => {
      const f = window.__fp, w = window.__app.world, p = w.player, cam = w.camera;
      f.aim(-0.8, 1.4, -0.8, 1.62, -3);
      const fov0 = cam.fov;
      f.set('rt', true, 1); f.step(60);
      const fovZoom = cam.fov;
      f.set('rt', false, 0); f.step(90);
      const fovBack = cam.fov;
      f.aim(-0.8, 1.4, -0.8, 1.62, -3);
      const y0 = p.yaw; f.set('lt', true, 1); f.axes(0, 0, 1, 0); f.step(30); f.axes(0, 0, 0, 0); f.set('lt', false, 0); f.step(20);
      return { fov0: +fov0.toFixed(1), fovZoom: +fovZoom.toFixed(1), fovBack: +fovBack.toFixed(1), fine: +(p.yaw - y0).toFixed(4) };
    });
    check('RT zooms in (field of view at least a third smaller) and back', trig.fovZoom < trig.fov0 * 0.67 && Math.abs(trig.fovBack - trig.fov0) < 2, trig);
    check('LT turns more finely (under half the speed)', Math.abs(trig.fine) < Math.abs(look.full.yaw) * 0.5 && Math.abs(trig.fine) > 0.05, { fine: trig.fine, full: look.full.yaw });

    // A on a book: into the basket, with a short rumble
    const take = await fp(async () => {
      const f = window.__fp, w = window.__app.world;
      const e = f.book(); const t = f.aimBook(e);
      const n0 = w.actions.basket.length, fx0 = f.fx.length;
      f.tap('a');
      await new Promise((r) => setTimeout(r, 300));
      const toast = [...document.querySelectorAll('#toasts .toast')].pop();
      return { t, inBasket: w.actions.basket.includes(e.book.id), n: w.actions.basket.length - n0, rumble: f.fx.slice(fx0), toastPad: !!toast?.querySelector('kbd.pad-y'), toast: toast?.textContent || '' };
    });
    check('A on a book takes it into the basket', take.t?.type === 'book' && take.inBasket && take.n === 1, take);
    check('taking a book rumbles shortly (dual-rumble, about 0.1 s)', take.rumble.length === 1 && take.rumble[0].type === 'dual-rumble' && take.rumble[0].duration <= 200, take.rumble);
    check('the note after taking a book names the pad\'s Y for the basket', take.toastPad, take.toast);
    await fp(() => { for (let i = 0; i < 40; i++) window.__app.world.actions.update(0.05); });
    // vibration off: no rumble
    const quiet = await fp(async () => {
      const f = window.__fp, w = window.__app.world, api = window.__app.ctx.api;
      await api.settings.set({ gamepad: { vibration: false } }); await new Promise((r) => setTimeout(r, 300));
      const e = f.book(); f.aimBook(e); const fx0 = f.fx.length; f.tap('a');
      await new Promise((r) => setTimeout(r, 200));
      const n = f.fx.length - fx0;
      await api.settings.set({ gamepad: { vibration: true } });
      for (let i = 0; i < 40; i++) w.actions.update(0.05);
      return { rumbles: n, taken: w.actions.basket.includes(e.book.id) };
    });
    check('"Vibration" off: a book is taken without a rumble', quiet.taken && quiet.rumbles === 0, quiet);
    // RB on a book: the info card; LB: read
    const info = await fp(async () => { const f = window.__fp; const e = f.book(); f.aimBook(e); f.tap('rb'); await new Promise((r) => setTimeout(r, 1200)); return { panels: f.panels() }; });
    check('RB on a book opens its info (F)', info.panels.includes('bookinfo'), info);
    await fp(() => window.__app.closeAllPanels()); await sleep(800);
    const read = await fp(async () => { const f = window.__fp; const e = f.book(); f.aimBook(e); f.tap('lb'); for (let i = 0; i < 60; i++) window.__app.world.actions.update(0.05); await new Promise((r) => setTimeout(r, 2500)); return { panels: f.panels(), id: e.book.id }; });
    check('LB on a book opens it in the reader (R)', read.panels.includes('reader'), read);
    await fp(() => window.__app.closeAllPanels()); await sleep(1500);
    // the books taken so far go back to their shelves
    await fp(() => { const a = window.__app.world.actions; a.returnAll(); for (let i = 0; i < 40; i++) a.update(0.05); });
    // X jumps
    const jump = await fp(() => { const f = window.__fp, p = window.__app.world.player; f.aim(-0.8, 1.4, -0.8, 1.62, -3); f.set('x', true); f.step(1); const air = !!p.air; f.set('x', false); f.step(80); return { air, landed: !p.air }; });
    check('X jumps', jump.air && jump.landed, jump);
    // Y opens the basket, B closes it
    const basket = await fp(async () => { const f = window.__fp; f.aim(-0.8, 1.4, -0.8, 1.62, -3); f.tap('y'); await new Promise((r) => setTimeout(r, 900)); const open = f.panels(); f.step(2, 1 / 60, false); f.tap('b', false); await new Promise((r) => setTimeout(r, 700)); return { open, after: f.panels() }; });
    check('Y opens the basket, B closes it', basket.open.includes('basket') && !basket.after.includes('basket'), basket);
    // the right stick pressed sits down on a chair in reach, B stands up; the left stick stands up as well
    const seat = await fp(() => {
      const f = window.__fp, w = window.__app.world, p = w.player, s = w.seats.get('table1a'), o = s.obj.position;
      p.setPose(o.x, o.z + 1.6, 0, Math.atan2(0.55 - 1.62, 1.6)); const t = f.look();
      f.tap('r3'); const sat = !!p.seated; f.step(40);
      f.tap('b'); const stoodB = !p.seated; f.step(40);
      p.setPose(o.x, o.z + 1.6, 0, Math.atan2(0.55 - 1.62, 1.6)); f.look(); f.tap('r3'); f.step(40);
      f.tap('r3'); const stoodR3 = !p.seated; f.step(40);
      p.setPose(o.x, o.z + 1.6, 0, Math.atan2(0.55 - 1.62, 1.6)); f.look(); f.tap('a'); f.step(70);
      const satA = !!p.seated;
      f.axes(0, -1); f.step(2); const stoodStick = !p.seated; f.axes(0, 0); f.step(40);
      p.setPose(o.x, o.z + 1.6, 0, Math.atan2(0.55 - 1.62, 1.6)); f.look(); f.tap('a'); f.step(40);
      f.tap('x'); const stoodX = !p.seated; f.step(40);
      return { t, sat, stoodB, stoodR3, satA, stoodStick, stoodX };
    });
    check('the right stick pressed sits down on a chair in reach, B stands up', seat.t?.type === 'seat' && seat.sat && seat.stoodB, seat);
    check('pressed again it stands up; A sits down, a push of the left stick or X stands up', seat.stoodR3 && seat.satA && seat.stoodStick && seat.stoodX, seat);
    // Start: the menu (Start again goes back), View: the places, View held: the department wheel
    const start = await fp(async () => { const f = window.__fp; f.tap('start'); await new Promise((r) => setTimeout(r, 900)); const open = f.panels(); f.step(2, 1 / 60, false); f.tap('start', false); await new Promise((r) => setTimeout(r, 700)); return { open, after: f.panels() }; });
    check('Start opens the menu, Start again goes back into the library', start.open.includes('menu') && start.after.length === 0, start);
    const view = await fp(async () => { const f = window.__fp; f.tap('view'); await new Promise((r) => setTimeout(r, 900)); const tab = document.querySelector('.menu-right h2')?.textContent || ''; const open = f.panels(); window.__app.closeAllPanels(); return { open, tab }; });
    check('View opens the places', view.open.includes('menu') && /Orte/.test(view.tab), view);
    await sleep(700);
    const wheel = await fp(async () => {
      const f = window.__fp, wh = document.querySelector('#wheel');
      f.set('view', true); f.step(25);
      const open = !wh.classList.contains('hidden');
      const hint = wh.querySelector('.wheel-hint')?.innerHTML || '';
      window.__app.world.frame();
      const before = wh.querySelectorAll('.wheel-sector.active').length ? [...wh.querySelectorAll('.wheel-sector')].findIndex((s) => s.classList.contains('active')) : -1;
      f.axes(0, 0, 0.0, 1.0); f.step(3);
      const pointed = [...wh.querySelectorAll('.wheel-sector')].findIndex((s) => s.classList.contains('active'));
      const n = wh.querySelectorAll('.wheel-sector').length;
      f.axes(0, 0, 0, 0); f.set('view', false); f.step(1); f.step(2);
      const closed = wh.classList.contains('hidden');
      return { open, hintPad: /kbd class="pad/.test(hint), before, pointed, n, closed };
    });
    check('View held opens the department wheel, a stick points at a sector, letting go picks it', wheel.open && wheel.hintPad && wheel.pointed === Math.round(wheel.n / 2) % wheel.n && wheel.closed, wheel);
    await fp(() => { const f = window.__fp; f.set('view', true); f.step(25); f.axes(0, 0, 0.7, -0.7); f.step(3); window.__app.world.frame(); });
    await sleep(250);
    await shot('cc-01b-wheel-pad');
    const cancel = await fp(async () => { const f = window.__fp; f.axes(0, 0, 0, 0); f.step(1); f.tap('b'); const open = !document.querySelector('#wheel').classList.contains('hidden'); f.set('view', false); f.step(2); await new Promise((r) => setTimeout(r, 500)); return { wheelOpen: open, panels: f.panels() }; });
    check('B closes the wheel while View is still held, letting go of View then opens nothing', !cancel.wheelOpen && cancel.panels.length === 0, cancel);
    await sleep(1500);
    // the D-pad: from book to book, the view glides there
    const dpad = await fp(() => {
      const f = window.__fp, w = window.__app.world;
      // the first book of a row with at least four books in its case, and a row above it
      const rows = new Map();
      for (const x of w.books.entries.values()) { if (x.hidden) continue; const k = x.bookcase?.id + '|' + x.row.y; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(x); }
      const R = (x) => x.pos.x * x.forward.z - x.pos.z * x.forward.x;
      const row = [...rows.values()].find((r) => r.length >= 4 && r[0].pos.y > 0.9 && r[0].pos.y < 1.6 && [...rows.keys()].some((k) => k.startsWith(r[0].bookcase?.id + '|') && +k.split('|')[1] > r[0].row.y + 0.1));
      const e = row ? row.sort((a, b) => R(a) - R(b))[0] : f.book(); const t0 = f.aimBook(e);
      const seq = [t0?.book];
      const go = (dir) => { f.set(dir, true); f.step(1); f.set(dir, false); f.step(30); return f.look(); };
      const r1 = go('right'); seq.push(r1?.book);
      const r2 = go('right'); seq.push(r2?.book);
      const l1 = go('left'); seq.push(l1?.book);
      const up = go('up'); seq.push(up?.book);
      const down = go('down'); seq.push(down?.book);
      const rowOf = (id) => { const x = w.books.entry(id); return x ? x.row?.y : null; };
      return { types: [t0, r1, r2, l1, up, down].map((x) => x?.type), seq, rows: seq.map(rowOf) };
    });
    const distinct = (a) => new Set(a).size;
    check('D-pad right, right, left: the neighbouring books in the row (the view glides onto them)', dpad.types.slice(0, 4).every((x) => x === 'book') && distinct(dpad.seq.slice(0, 3)) === 3 && dpad.seq[3] === dpad.seq[1] && dpad.rows[1] === dpad.rows[0], dpad);
    check('D-pad up and down: the row above, then back to the row', dpad.types[4] === 'book' && dpad.types[5] === 'book' && dpad.rows[4] > dpad.rows[3] && dpad.rows[5] === dpad.rows[3], dpad);
    // the last book of a row on a wall: right does not turn round the corner to another wall
    const end = await fp(() => {
      const f = window.__fp, w = window.__app.world, p = w.player;
      const e0 = f.book(); f.aimBook(e0);
      const fw = e0.forward, R = { x: fw.z, z: -fw.x };
      const wall = [...w.books.entries.values()].filter((x) => !x.hidden && x.forward.dot(fw) > 0.97 && Math.abs(x.row.y - e0.row.y) < 0.01 && Math.abs((x.pos.x - e0.pos.x) * fw.x + (x.pos.z - e0.pos.z) * fw.z) < 0.05);
      const last = wall.reduce((a, b) => (b.pos.x * R.x + b.pos.z * R.z > a.pos.x * R.x + a.pos.z * R.z ? b : a));
      const t0 = f.aimBook(last);
      const yaw0 = p.yaw;
      f.set('right', true); f.step(1);
      const aim = window.__app.pad.aim, chosen = aim?.id ? w.books.entry(aim.id) : null;
      f.set('right', false); f.step(30);
      const t1 = f.look();
      const info = (x) => (x ? { id: x.book.id, pos: x.pos.toArray().map((n) => +n.toFixed(2)), fw: x.forward.toArray().map((n) => +n.toFixed(2)), row: x.row.y, case: x.bookcase?.id, d: +x.pos.distanceTo(w.camera.position).toFixed(2) } : null);
      return { last: last.book.id, t0: t0?.book, t1: t1?.book, turn: +Math.abs(p.yaw - yaw0).toFixed(3), lastInfo: info(last), chosen: info(chosen), wall: wall.length };
    });
    check('at the end of a row D-pad right stays on the wall (no turn round a corner)', end.t0 === end.last && end.turn < 0.35 && end.t1 != null, end);
  }

  // ================================================================= 4. the hints =================================================
  if (want('hints')) {
    const hints = await fp(async () => {
      const f = window.__fp, w = window.__app.world;
      f.tap('l3'); f.tap('l3');
      const e = f.book(); f.aimBook(e);
      await new Promise((r) => setTimeout(r, 500));
      const card = [...document.querySelectorAll('#book-peek .peek-keys > span')].map((s) => [...s.querySelectorAll('kbd')].map((k) => (k.classList.contains('pad') ? 'pad:' : 'key:') + (k.textContent || (k.querySelector('svg') ? 'svg' : ''))).join('+') + ' ' + [...s.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim());
      const basket = document.querySelector('#basket-hud .bk-key kbd');
      const q = w.layout.placements.find((x) => x.kind === 'computer');
      f.aim(q.meta.standAt[0], q.meta.standAt[1], q.x, 1.0, q.z);
      await new Promise((r) => setTimeout(r, 300));
      const label = document.querySelector('#look-label .ll-keys kbd');
      return { card, basket: basket ? (basket.classList.contains('pad') ? 'pad:' : 'key:') + basket.textContent : null, label: label ? (label.classList.contains('pad') ? 'pad:' : 'key:') + label.textContent : null, input: document.documentElement.dataset.input || null, click: document.querySelector('#pointer-hint').classList.contains('show') };
    });
    check('with the pad: the book card shows A, LB, RB and the D-pad', hints.card.join(' | ') === 'pad:A In den Korb | pad:LB Lesen | pad:RB Info | pad:svg Nachbarbuch', hints.card);
    check('with the pad: the basket shows Y, the label below the crosshair A, no "Klicken, um dich umzusehen"', hints.basket === 'pad:Y' && hints.label === 'pad:A' && !hints.click, hints);
    await fp(async () => { const f = window.__fp; const e = f.book(); f.aimBook(e); await new Promise((r) => setTimeout(r, 500)); window.__app.world.frame(); });
    await shot('cc-01-hud-pad-card');
    // a real key: the keys again
    await page.keyboard.press('Shift');
    await sleep(500);
    const keys = await fp(async () => {
      const f = window.__fp; const e = f.book(); f.aimBook(e);
      await new Promise((r) => setTimeout(r, 500));
      const card = [...document.querySelectorAll('#book-peek .peek-keys > span')].map((s) => s.textContent.replace(/\s+/g, ' ').trim());
      return { input: document.documentElement.dataset.input || null, card, basket: document.querySelector('#basket-hud .bk-key')?.textContent.replace(/\s+/g, ' ').trim(), padKbd: [...document.querySelectorAll('#hud kbd.pad')].filter((k) => k.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length };
    });
    check('a real key: the hints show the keys again (E In den Korb · R Lesen · F Info)', keys.input === null && keys.card.slice(0, 3).join(' · ') === 'E In den Korb · R Lesen · F Info' && keys.basket === 'B Korb öffnen' && keys.padKbd === 0, keys);
    await fp(() => window.__fp.tap('a'));    // the pad again (A also takes the book)
    const back = await fp(() => document.documentElement.dataset.input || null);
    await page.mouse.move(200, 200); await page.mouse.move(260, 240); await page.mouse.move(330, 300);
    await sleep(300);
    const mouse = await fp(() => document.documentElement.dataset.input || null);
    check('the pad again, then a real mouse movement: the keys again', back === 'pad' && mouse === null, { back, mouse });
    await fp(() => { const a = window.__app.world.actions; for (let i = 0; i < 40; i++) a.update(0.05); });
    // seated: the chip names B and the left stick
    const chip = await fp(async () => {
      const f = window.__fp, w = window.__app.world, p = w.player, s = w.seats.get('table1a');
      f.tap('l3'); f.tap('l3');
      p.transition = null; p.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); f.step(40);
      const el = [...document.querySelectorAll('#hud-bottom .hud-chip')].find((x) => !x.classList.contains('hidden'));
      const r = el ? [...el.querySelectorAll('kbd')].map((k) => k.className.replace('pad ', '')) : null;
      w.actions.stand(); f.step(40);
      return r;
    });
    check('seated: the chip shows B and the left stick for standing up', chip && chip.some((c) => /pad-b/.test(c)) && chip.some((c) => /pad-stick/.test(c)), chip);
  }

  // ================================================================= 5. the menu ==================================================
  if (want('menu')) {
    const menu = await fp(async () => {
      const f = window.__fp, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      f.tap('start', false); await wait(1000); f.step(2, 1 / 60, false);
      const r0 = f.ring();
      f.tap('down', false); await wait(150); f.step(10, 1 / 60, false); const r1 = f.ring();
      f.tap('a', false); await wait(400); f.step(2, 1 / 60, false);
      const guide = document.querySelector('.menu-right h2')?.textContent || '';
      f.tap('rb', false); await wait(400); f.step(3, 1 / 60, false);
      const places = document.querySelector('.menu-right h2')?.textContent || '';
      const r2 = f.ring();
      f.tap('down', false); f.step(10, 1 / 60, false); f.tap('down', false); f.step(10, 1 / 60, false); f.tap('right', false); f.step(10, 1 / 60, false);
      const r3 = f.ring();
      return { r0, r1, guide, places, r2, r3 };
    });
    check('the menu: the ring starts on the first button ("Weiter") and moves down to "Anleitung"', menu.r0.show && /Weiter/.test(menu.r0.on) && menu.r1.show && /Anleitung/.test(menu.r1.on) && menu.r1.y > menu.r0.y, { r0: menu.r0, r1: menu.r1 });
    check('A presses "Anleitung", RB switches to the places, the ring follows the tab', /zurecht/.test(menu.guide) && /Orte/.test(menu.places) && /Orte/.test(menu.r2.on), menu);
    check('the D-pad reaches the places on the right (a place button)', menu.r3.show && menu.r3.x > menu.r2.x + 100, menu.r3);
    await fp(() => window.__app.world.frame());
    await shot('cc-02-menu-ring');
    const closed = await fp(async () => { const f = window.__fp; f.tap('b', false); await new Promise((r) => setTimeout(r, 700)); return { panels: f.panels(), ring: f.ring().show }; });
    check('B closes the menu, the ring goes', closed.panels.length === 0 && !closed.ring, closed);
  }

  // ================================================================= 6. the settings ==============================================
  if (want('settings')) {
    const s1 = await fp(async () => {
      const f = window.__fp, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      f.tap('start', false); await wait(900); f.step(2, 1 / 60, false);
      for (let i = 0; i < 8 && !/Einstellungen/.test(f.ring().on || ''); i++) { f.tap('down', false); f.step(2, 1 / 60, false); }
      const on = f.ring().on;
      f.tap('a', false); await wait(1200); f.step(2, 1 / 60, false);
      return { on, panels: f.panels(), ring: f.ring() };
    });
    check('the D-pad and A lead from the menu to the settings', /Einstellungen/.test(s1.on) && s1.panels.includes('settings'), s1);
    const s2 = await fp(async () => {
      const f = window.__fp, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const active = () => document.querySelector('.settings-nav button.active')?.textContent || '';
      for (let i = 0; i < 10 && active() !== 'Controller'; i++) { f.tap('rb', false); await wait(120); f.step(2, 1 / 60, false); }
      return { active: active(), ring: f.ring(), status: document.querySelector('.pad-status')?.textContent || '', figure: !!document.querySelector('.pad-figure svg'), rows: document.querySelectorAll('.pad-row').length };
    });
    check('RB steps through the sections up to "Controller", the ring follows the tab', s2.active === 'Controller' && /Controller/.test(s2.ring.on), { active: s2.active, ring: s2.ring });
    check('"Controller": connected with the name of the pad, the picture and the list of buttons', /Verbunden/.test(s2.status) && /Xbox Wireless Controller/.test(s2.status) && s2.figure && s2.rows >= 15, s2);
    const lit = await fp(async () => {
      const f = window.__fp;
      f.set('y', true); f.step(2, 1 / 60, false); await new Promise((r) => setTimeout(r, 150));
      const on = !!document.querySelector('.pad-figure [data-b="3"].lit');
      f.set('y', false); f.step(2, 1 / 60, false); await new Promise((r) => setTimeout(r, 150));
      const off = !document.querySelector('.pad-figure [data-b="3"].lit');
      return { on, off };
    });
    check('a pressed button lights up in the picture', lit.on && lit.off, lit);
    // to "Y invertieren" with the D-pad, A switches it; up to the sensitivity, right raises it
    const s3 = await fp(async () => {
      const f = window.__fp, P = window.__app.pad, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const label = () => P.nav.el?.getAttribute('aria-label') || P.nav.el?.textContent?.trim() || '';
      const path = [];
      f.tap('right', false); f.step(2, 1 / 60, false); path.push(label());
      for (let i = 0; i < 6 && label() !== 'Y invertieren'; i++) { f.tap('up', false); f.step(2, 1 / 60, false); path.push(label()); }
      for (let i = 0; i < 8 && label() !== 'Y invertieren'; i++) { f.tap('down', false); f.step(2, 1 / 60, false); path.push(label()); }
      const reached = label() === 'Y invertieren';
      f.tap('a', false); await wait(500);
      const inv = (await window.api.settings.get()).gamepad?.invertY;
      f.tap('a', false); await wait(500);
      const back = (await window.api.settings.get()).gamepad?.invertY;
      f.tap('up', false); f.step(2, 1 / 60, false); path.push(label() + '/' + (P.nav.el?.tagName || '') + '/' + (P.nav.el?.type || ''));
      const slider = P.nav.el?.type === 'range' ? +P.nav.el.value : null;
      f.tap('right', false); f.step(2, 1 / 60, false); f.tap('right', false); f.step(2, 1 / 60, false);
      await wait(700);
      const sens = (await window.api.settings.get()).gamepad?.sensitivity;
      f.tap('left', false); f.step(2, 1 / 60, false); f.tap('left', false); f.step(2, 1 / 60, false);
      await wait(700);
      const sensBack = (await window.api.settings.get()).gamepad?.sensitivity;
      return { path, reached, inv, back, slider, sens, sensBack };
    });
    check('the D-pad reaches "Y invertieren", A switches it on and off', s3.reached && s3.inv === true && s3.back === false, s3);
    check('up to the sensitivity slider: right raises it, left lowers it again', s3.slider === 1 && s3.sens > 1.05 && Math.abs(s3.sensBack - 1) < 0.001, s3);
    await fp(() => { window.__fp.tap('up', false); window.__fp.step(2, 1 / 60, false); });
    await sleep(300);
    await shot('cc-03-settings-controller');
    await fp(() => window.__app.closeAllPanels()); await sleep(800);
  }

  // ================================================================= 7. the reader ================================================
  if (want('reader')) {
    const book = await cc(() => { const bs = window.__app.state.library.books; const b = bs.find((x) => /Sammelband/.test(x.title || '') && /epub/i.test(x.format || '')) || bs.find((x) => /epub/i.test(x.format || '')); return b ? { id: b.id, title: b.title } : null; });
    if (!book) console.log('SKIP reader: no EPUB in this test library');
    else {
      await cc((id) => { window.__fp.aim(-0.8, 1.4, -0.8, 1.62, -3); window.__app.ctx.bus.emit('book:open', { id }); }, book.id);
      await sleep(6000);
      const pos = () => cc(() => { const l = document.querySelector('.panel-layer[data-panel="reader"]'); return l ? +(l.querySelector('.rd-slider')?.value || 0) : null; });
      const tap = (b) => fp((b) => { window.__fp.step(1, 1 / 60, false); window.__fp.tap(b, false); }, b);
      // (a turn into the next section takes a moment to draw; the reader takes no other turn meanwhile, as with the keys)
      // (under load a section can take well over a second: the position must stand still for 1.5 s)
      const settle = async () => { let a = await pos(), same = 0; for (let i = 0; i < 40 && same < 5; i++) { await sleep(300); const b = await pos(); same = b === a ? same + 1 : 0; a = b; } return a; };
      await tap('l3');              // (wakes the pad when this part runs alone: the first press only shows the ring)
      const p0 = await settle();
      await tap('rb'); await sleep(600); const p1 = await settle();
      await tap('right'); await sleep(600); const p2 = await settle();
      await tap('lb'); await sleep(600); const p3 = await settle();
      const noRing = await fp(() => window.__fp.ring().show);
      check('reader: RB and the D-pad turn the page forward, LB back; no ring over the page', p1 > p0 && p2 > p1 && p3 < p2 && !noRing, { p0, p1, p2, p3, ring: noRing });
      const bars = await fp(async () => { const f = window.__fp; f.tap('a', false); await new Promise((r) => setTimeout(r, 400)); f.step(2, 1 / 60, false); return { ring: f.ring(), hidden: document.querySelector('.rd-root').classList.contains('rd-chrome-hidden') }; });
      await sleep(3600);
      const stay = await fp(() => { window.__fp.step(1, 1 / 60, false); return document.querySelector('.rd-root').classList.contains('rd-chrome-hidden'); });
      check('A shows the bars with the ring on "Inhalt", they stay while the ring is there', bars.ring.show && /Inhalt/.test(bars.ring.on) && !bars.hidden && !stay, { bars, hiddenLater: stay });
      const moved = await fp(() => { const f = window.__fp; f.tap('right', false); f.step(2, 1 / 60, false); return f.ring(); });
      check('in the bars the D-pad moves the ring to the next button', moved.show && moved.on !== bars.ring.on && moved.x > bars.ring.x, moved);
      await shot('cc-04-reader-bars');
      const mark = await fp(async () => { const f = window.__fp; const n = () => document.querySelector('.rd-ribbon')?.classList.contains('show'); const before = n(); f.tap('x', false); await new Promise((r) => setTimeout(r, 400)); const after = n(); f.tap('x', false); await new Promise((r) => setTimeout(r, 400)); return { before, after, again: n() }; });
      check('X sets a bookmark and takes it away again', !mark.before && mark.after && !mark.again, mark);
      const leave = await fp(async () => { const f = window.__fp; f.tap('b', false); f.step(2, 1 / 60, false); const r = f.ring(); await new Promise((res) => setTimeout(res, 3300)); return { ring: r.show, panels: f.panels(), hidden: document.querySelector('.rd-root').classList.contains('rd-chrome-hidden') }; });
      check('B leaves the bars (the ring goes, the bars hide after a moment), the book stays open', !leave.ring && leave.panels.includes('reader') && leave.hidden, leave);
      // Y: read aloud (without a voice on this computer the bar offers the download; nothing is fetched), B stops it
      const tts = await fp(async () => {
        const f = window.__fp, bar = () => document.querySelector('.rd-ttsbar'), shown = () => !!bar() && !bar().classList.contains('hidden');
        f.tap('y', false);
        for (let i = 0; i < 30 && !shown(); i++) await new Promise((r) => setTimeout(r, 200));
        const on = shown(), offer = !!bar()?.classList.contains('offer');
        f.tap('b', false); await new Promise((r) => setTimeout(r, 400));
        return { on, offer, off: !shown(), panels: f.panels() };
      });
      check('Y starts reading aloud (the bar, here with the offer of the voice), B stops it and the book stays open', tts.on && tts.off && tts.panels.includes('reader'), tts);
      const closed = await fp(async () => { const f = window.__fp; f.tap('b', false); await new Promise((r) => setTimeout(r, 1500)); return f.panels(); });
      check('B on the page closes the book', !closed.includes('reader'), closed);
      await sleep(800);
    }
  }

  // ================================================================= 8. films: mini player, Mediathek, full screen ================
  if (want('media')) {
    await cc(() => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'); let t = 0;
      const draw = () => { t++; ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 360); }); g.fillStyle = '#ffcf40'; g.beginPath(); g.arc(320 + Math.sin(t / 10) * 200, 180, 40, 0, Math.PI * 2); g.fill(); };
      draw(); window.__ccTimer = setInterval(draw, 40);
      window.__ccFilm = () => ({ id: 'cc-test-film', title: 'Testbild der Bücherei', channel: 'Cozy Shelves', stream: c.captureStream(25) });
      const mp = globalThis.__cozyshelvesMediaPlayer; window.__skips = [];
      if (!mp.__ccSkip) { const skip = mp.skip.bind(mp); mp.skip = (d) => { window.__skips.push(d); return skip(d); }; mp.__ccSkip = true; }
      mp.play(window.__ccFilm(), { mode: 'audio' });
    });
    await page.waitForFunction(() => !globalThis.__cozyshelvesMediaPlayer.video.paused, null, { timeout: 15000 }).catch(() => {});
    await sleep(700);
    const mini = await fp(async () => {
      const f = window.__fp, mp = globalThis.__cozyshelvesMediaPlayer, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      f.tap('l3'); f.tap('l3');
      f.aim(-0.8, 1.4, -0.8, 5.0, 1.3);       // the ceiling: no book in view
      await wait(300);
      const row = [...document.querySelectorAll('#media-bar .mb-padkeys > .mb-key')].map((k) => k.querySelector('kbd')?.className.replace('pad ', '') + ' ' + k.textContent.trim());
      const keysHidden = getComputedStyle(document.querySelector('#media-bar .mb-keys')).display === 'none';
      window.__skips.length = 0;
      f.tap('right'); f.tap('left');
      const seeks = window.__skips.slice();
      f.tap('down'); f.step(2);
      const zone = window.__app.pad.hudZone, ring = f.ring(), onPlay = !!window.__app.pad.nav.el?.classList.contains('mb-play');
      f.tap('a'); await wait(300);
      const paused = mp.video.paused;
      f.tap('a'); await wait(300);
      const playing = !mp.video.paused;
      return { row, keysHidden, seeks, zone, ring, onPlay, paused, playing };
    });
    check('the mini player with the pad: the D-pad for 10 s and "Bedienen" instead of the keys', mini.keysHidden && mini.row.length === 2 && /pad-dpad/.test(mini.row[0]) && /10 s/.test(mini.row[0]) && /Bedienen/.test(mini.row[1]), mini);
    check('the D-pad right and left seek the film (+10 s, -10 s) when no book is in view', mini.seeks.join(',') === '10,-10', mini.seeks);
    check('D-pad down leads into the mini player (the ring on its play button), A pauses and plays', mini.zone && mini.ring.show && mini.onPlay && mini.paused && mini.playing, mini);
    await fp(() => window.__app.world.frame());
    await shot('cc-05-miniplayer-pad');
    const leave = await fp(() => { const f = window.__fp; f.tap('b'); f.step(2); return { zone: window.__app.pad.hudZone, ring: f.ring().show }; });
    check('B leaves the mini player', !leave.zone && !leave.ring, leave);
    // the film in the Mediathek: the ring on the film, A pause and play, left and right seek, down into its controls, B back
    await cc(() => window.__app.ctx.openPanel('mediathek', { show: 'player' }));
    await sleep(2500);
    const mt = await fp(async () => {
      const f = window.__fp, mp = globalThis.__cozyshelvesMediaPlayer, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      f.step(2, 1 / 60, false);
      const r0 = f.ring(), stage = !!window.__app.pad.nav.el?.classList.contains('mt-stage');
      f.tap('a', false); await wait(300); const paused = mp.video.paused;
      f.tap('a', false); await wait(300); const playing = !mp.video.paused;
      window.__skips.length = 0;
      f.tap('right', false); f.tap('left', false);
      const seeks = window.__skips.slice();
      f.tap('down', false); f.step(2, 1 / 60, false);
      const r1 = f.ring();
      const ctl = window.__app.pad.nav.el?.className || '';
      return { r0, stage, paused, playing, seeks, r1, ctl, mode: mp.mode };
    });
    check('Mediathek: the ring rests on the film; A pauses and plays', mt.stage && mt.r0.show && mt.paused && mt.playing, mt);
    check('Mediathek: left and right seek 10 s, down leads to the play button of the film', mt.seeks.join(',') === '10,-10' && /mt-cplay/.test(mt.ctl), mt);
    await sleep(200);
    await shot('cc-06-mediathek-controls');
    const mtb = await fp(async () => { const f = window.__fp; f.tap('b', false); await new Promise((r) => setTimeout(r, 500)); f.step(2, 1 / 60, false); const detail = !!document.querySelector('.mt-detail:not(.hidden)'); f.tap('b', false); await new Promise((r) => setTimeout(r, 900)); return { detail, panels: f.panels(), mode: globalThis.__cozyshelvesMediaPlayer.mode }; });
    check('B closes the film view, B again the Mediathek (the film plays on as sound)', !mtb.detail && !mtb.panels.includes('mediathek') && mtb.mode === 'audio', mtb);
    await sleep(600);
    // the film in full screen: A pause and play, RB and right 10 s, B back
    await cc(() => window.__app.ctx.bus.emit('media:fullscreen'));
    await sleep(800);
    const ff = await fp(async () => {
      const f = window.__fp, mp = globalThis.__cozyshelvesMediaPlayer, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const open = mp.mode === 'full';
      f.tap('a', false); await wait(300); const paused = mp.video.paused;
      f.tap('a', false); await wait(300); const playing = !mp.video.paused;
      window.__skips.length = 0; f.tap('rb', false); f.tap('right', false); const seeks = window.__skips.slice();
      f.tap('b', false); await wait(500);
      return { open, paused, playing, seeks, after: mp.mode };
    });
    check('the film in full screen: A pauses and plays, RB and right +10 s, B back to sound', ff.open && ff.paused && ff.playing && ff.seeks.join(',') === '10,10' && ff.after === 'audio', ff);
    await cc(() => { globalThis.__cozyshelvesMediaPlayer.stop(); clearInterval(window.__ccTimer); });
    await sleep(600);
  }

  // ================================================================= 9. the world map, the keyboard on the screen =================
  if (want('map')) {
    // the tiles of the map (OpenStreetMap in Leaflet) are answered by the check; the route goes again after this part
    const tiles = await serveTiles({ page, app });
    await cc(() => window.__app.ctx.openPanel('worldmap', {}));
    await page.waitForFunction(() => document.querySelector('.wm-panel')?.__wm?.stats().loaded > 0, null, { timeout: 30000 }).catch(() => {});
    await sleep(1500);
    const m0 = await fp(async () => {
      const f = window.__fp;
      f.tap('l3', false);           // (wakes the pad when this part runs alone)
      f.step(3, 1 / 60, false); await new Promise((r) => setTimeout(r, 300));
      const wm = document.querySelector('.wm-panel').__wm;
      return { ring: f.ring(), onMap: !!window.__app.pad.nav.el?.classList.contains('wm-osm'), cross: !!document.querySelector('.wm-pad-aim.show'), center: wm.view.center, zoom: wm.view.zoom, tiles: wm.stats().loaded };
    });
    // the map is Leaflet's field with OpenStreetMap's tiles since 0.9.1 (osm-view.js)
    check('world map: the ring rests on the map (the field with the tiles), a cross marks its middle', m0.onMap && m0.ring.tag === 'DIV' && m0.cross && m0.tiles > 0, m0);
    const m1 = await fp(() => {
      const f = window.__fp, wm = document.querySelector('.wm-panel').__wm;
      // closer than the whole world: there the map shows the one world from edge to edge (no copies beside it since
      // 0.9.2) and has nowhere to go sideways
      wm.view.map.setView([40, 0], 4, { animate: false });
      const a = { center: wm.view.center, zoom: wm.view.zoom };
      f.axes(1, 0); f.step(30, 1 / 60, false); f.axes(0, 0); f.step(1, 1 / 60, false);
      const b = { center: wm.view.center };
      f.set('rt', true, 1); f.step(30, 1 / 60, false); f.set('rt', false, 0); f.step(1, 1 / 60, false);
      return { a, b, zoom: wm.view.zoom };
    });
    // half a second at full tilt: 450 px east; RT for half a second: 1.3 levels in quarter steps
    check('the left stick moves the map east, RT zooms in', m1.b.center[0] > m1.a.center[0] + 5 && Math.abs(m1.b.center[1] - m1.a.center[1]) < 0.5 && m1.zoom >= m1.a.zoom + 1, m1);
    // the views of the atlas: the D-pad goes down from the map onto the switch at its bottom, A picks a view, the stick
    // takes the ring back onto the map
    const mv = await fp(async () => {
      const f = window.__fp, P = window.__app.pad, wm = document.querySelector('.wm-panel').__wm, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      wm.view.map.setView([40, 0], 3, { animate: false });
      const on = () => { const el = P.nav.el; return !el ? null : el.classList.contains('wm-mode') ? el.textContent : el.classList.contains('wm-canvas') ? 'map' : el.className || `${el.tagName}:${el.textContent.trim().slice(0, 24)}`; };
      const go = (d) => { f.tap(d, false); f.step(2, 1 / 60, false); path.push(on()); };
      const path = [on()];
      go('down');
      for (let i = 0; i < 4 && on() !== 'Kontinente'; i++) go(P.nav.el?.classList.contains('wm-mode') && [...P.nav.el.parentElement.children].indexOf(P.nav.el) > 1 ? 'left' : 'right');
      f.tap('a', false); await wait(300); f.step(2, 1 / 60, false);
      const picked = wm.stats().mode;
      for (let i = 0; i < 3 && on() !== 'Länder'; i++) go('left');
      f.tap('a', false); await wait(300); f.step(2, 1 / 60, false);
      const back = wm.stats().mode;
      f.axes(0.4, 0); f.step(2, 1 / 60, false); f.axes(0, 0); f.step(1, 1 / 60, false); path.push(on());
      return { path, picked, back, onMap: on() === 'map' };
    });
    check('the D-pad reaches the views of the map: A on "Kontinente" colours the continents, on "Länder" back; the stick takes the ring onto the map again', mv.path.includes('Kontinente') && mv.picked === 'continents' && mv.back === 'countries' && mv.onMap, mv);
    const m2 = await fp(async () => {
      const f = window.__fp, wm = document.querySelector('.wm-panel').__wm, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const d = wm.data.byId.get('DEU');
      wm.view.map.setView([d.lbl[1], d.lbl[0]], 5, { animate: false });
      // the cross asks the map what lies under it while it moves and every 400 ms at rest
      f.step(2, 1 / 60, false); await wait(450); f.step(1, 1 / 60, false);
      const t = document.querySelector('.wm-tip');
      const hover = { tip: t.hidden ? '' : t.textContent, pointing: wm.view.el.classList.contains('pointing') };
      f.tap('a', false); await wait(600); f.step(3, 1 / 60, false);
      return { hover, sel: wm.state().sel, card: !!document.querySelector('.wm-card:not([hidden])') };
    });
    check('the cross over Germany: its name with the capital at the cross and the hand', /Deutschland/.test(m2.hover.tip) && /Hauptstadt Berlin/.test(m2.hover.tip) && m2.hover.pointing, m2.hover);
    check('A opens the card of the country under the cross', m2.sel?.country === 'DEU' && m2.card, m2);
    await sleep(900);
    await fp(() => window.__fp.step(3, 1 / 60, false));
    await shot('cc-07-worldmap-cross-card');
    // up into the header and on to the search field; A: the keyboard on the screen
    const m3 = await fp(async () => {
      const f = window.__fp, P = window.__app.pad, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const isSearch = () => P.nav.el?.classList.contains('wm-search');
      const path = [];
      f.tap('up', false); f.step(2, 1 / 60, false); path.push(f.ring().on);
      const sx = () => document.querySelector('.wm-search').getBoundingClientRect().left;
      for (let i = 0; i < 8 && !isSearch(); i++) { f.tap(P.nav.el && P.nav.el.getBoundingClientRect().left > sx() ? 'left' : 'right', false); f.step(2, 1 / 60, false); path.push(f.ring().on); }
      const reached = isSearch();
      f.tap('a', false); await wait(300);
      const osk = !!document.querySelector('#pad-osk');
      // r (q w e r), o (... i o), m (down twice, then left)
      const go = (d, n = 1) => { for (let i = 0; i < n; i++) f.tap(d, false); };
      go('right', 3); f.tap('a', false);
      go('right', 5); f.tap('a', false);
      go('down', 2); go('left', 1); f.tap('a', false);
      await wait(300);
      const value = document.querySelector('.wm-search').value;
      const results = [...document.querySelectorAll('.wm-res')].map((r) => r.textContent).slice(0, 3);
      return { path, reached, osk, value, results };
    });
    check('the D-pad reaches the search field, A opens the keyboard on the screen', m3.reached && m3.osk, m3);
    check('typing with the D-pad and A: "rom", the search lists Rom', m3.value === 'rom' && m3.results.some((r) => /Rom/.test(r)), m3);
    await shot('cc-08-keyboard-on-screen');
    const m4 = await fp(async () => { const f = window.__fp, wm = document.querySelector('.wm-panel').__wm; f.tap('start', false); await new Promise((r) => setTimeout(r, 900)); return { osk: !!document.querySelector('#pad-osk'), sel: wm.state().sel }; });
    check('Start (Fertig) takes the first hit and closes the keyboard', !m4.osk && !!(m4.sel?.city || m4.sel?.country) && m4.sel?.country !== 'DEU', m4);
    const m5 = await fp(async () => { const f = window.__fp; for (let i = 0; i < 5 && f.panels().includes('worldmap'); i++) { f.tap('b', false); await new Promise((r) => setTimeout(r, 400)); f.step(2, 1 / 60, false); } return f.panels(); });
    check('B closes the search, the card and the map in turn', !m5.includes('worldmap'), m5);
    check('the tiles of the map came from the check (none from OpenStreetMap, every address a real tile)', tiles.served > 0 && !tiles.unrouted().length && !tiles.bad.length, { served: tiles.served, unrouted: tiles.unrouted().slice(0, 3), bad: tiles.bad.slice(0, 3) });
    await tiles.stop();
    await sleep(800);
  }

  // ================================================================= 10. a game on the computer ===================================
  if (want('computer')) {
    await cc(() => window.__app.ctx.openPanel('computer', { section: 'games', game: '2048' }));
    await sleep(2500);
    const g = await fp(async () => {
      const f = window.__fp, P = window.__app.pad;
      const keys = []; const on = (e) => { if (/^(Arrow|Enter| )/.test(e.key)) keys.push(e.key); };
      f.tap('l3', false);           // (wakes the pad when this part runs alone)
      document.addEventListener('keydown', on, true);
      f.step(2, 1 / 60, false);
      const onBoard = !!P.nav.el?.classList.contains('term-game-body');
      const ring = f.ring().show;
      const dbg = { el: P.nav.el?.className || null, ctx: P.context, input: document.documentElement.dataset.input || null, body: document.querySelector('.term-game-body')?.firstElementChild?.className || null, notice: !!document.querySelector('.term-game-body > .term-notice') };
      f.tap('left', false); f.tap('up', false); f.tap('right', false); f.tap('down', false); f.tap('x', false);
      document.removeEventListener('keydown', on, true);
      f.tap('rb', false); f.step(2, 1 / 60, false);
      const btn = f.ring();
      return { onBoard, ring, keys, btn, dbg };
    });
    check('a game on the computer: the D-pad and X are the arrow keys and Space (no ring over the board)', g.onBoard && !g.ring && g.keys.join(',') === 'ArrowLeft,ArrowUp,ArrowRight,ArrowDown, ', g);
    check('RB puts the ring on the buttons of the game', g.btn.show && g.btn.tag === 'BUTTON', g.btn);
    await shot('cc-09-computer-game');
    await fp(() => window.__app.closeAllPanels()); await sleep(800);
  }

  // ================================================================= 10b. the pointer (R3): real mouse input ======================
  if (want('pointer')) {
    await cc(() => window.__app.ctx.openPanel('chess', {}));
    await page.waitForFunction(() => document.querySelector('.panel-layer[data-panel="chess"] cg-board'), null, { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const wait = (ms) => sleep(ms);
    const p0 = await fp(() => {
      const f = window.__fp, P = window.__app.pad;
      f.step(2, 1 / 60, false);
      f.tap('l3', false);           // (wakes the pad when this part runs alone)
      f.tap('r3', false);
      const c = P.cursor;
      const at0 = { x: c.x, y: c.y };
      f.axes(1, 0); f.step(20, 1 / 60, false); f.axes(0, 0); f.step(1, 1 / 60, false);
      return { on: c.on, el: !!document.querySelector('#pad-cursor'), hint: document.querySelector('#pad-cursor-hint')?.textContent || '', moved: +(c.x - at0.x).toFixed(1), ring: f.ring().show };
    });
    check('R3 in a panel shows the pointer (the ring goes), the left stick moves it', p0.on && p0.el && p0.moved > 150 && !p0.ring && /Zeiger/.test(p0.hint), p0);
    // e2 to e4 with the pointer: A on the pawn, A on the square (the board only takes real mouse input)
    // (the table opens with a game against Stockfish: its list of moves shows what happened)
    const movesText = () => cc(() => (document.querySelector('.panel-layer[data-panel="chess"]')?.innerText || '').replace(/\s+/g, ' '));
    const sq = await cc(() => { const r = document.querySelector('.panel-layer[data-panel="chess"] cg-board').getBoundingClientRect(); const s = r.width / 8; return { e2: [r.left + 4.5 * s, r.top + 6.5 * s], e4: [r.left + 4.5 * s, r.top + 4.5 * s] }; });
    const before = await movesText();
    const clickAt = async ([x, y]) => {
      await fp(([x, y]) => { const f = window.__fp, c = window.__app.pad.cursor; c.x = x - 4; c.y = y; f.tap('right', false); }, [x, y]);
      await wait(150);
      await fp(() => { const f = window.__fp; f.set('a', true); f.step(1, 1 / 60, false); }); await wait(120);
      await fp(() => { const f = window.__fp; f.set('a', false); f.step(1, 1 / 60, false); }); await wait(200);
    };
    await clickAt(sq.e2);
    await clickAt(sq.e4);
    await wait(500);
    const after = { text: await movesText(), input: await cc(() => document.documentElement.dataset.input || null) };
    check('the pointer plays e2-e4 on the chess board (real mouse input through Electron)', !/1\.\s*e4/.test(before) && /1\.\s*e4/.test(after.text), { before: before.slice(0, 160), after: after.text.slice(0, 200) });
    check('the pointer\'s mouse events keep the pad as the input used last', after.input === 'pad', after.input);
    await fp(() => { const c = window.__app.pad.cursor; c.x = innerWidth * 0.62; c.y = innerHeight * 0.5; window.__fp.tap('right', false); });
    await wait(300);
    await shot('cc-11-pointer-chess');
    const off = await fp(() => { const f = window.__fp, P = window.__app.pad; f.tap('b', false); f.step(2, 1 / 60, false); return { on: P.cursor.on, el: !!document.querySelector('#pad-cursor'), ring: f.ring().show, panels: f.panels() }; });
    check('B ends the pointer, the ring is back, the panel stays open', !off.on && !off.el && off.ring && off.panels.includes('chess'), off);
    await fp(() => window.__app.closeAllPanels()); await sleep(800);
    // the wheel: the pointer over a long list, the right stick scrolls it
    await cc(() => window.__app.ctx.openPanel('settings', { section: 'controller' }));
    await sleep(1200);
    const wheel = await fp(async () => {
      const f = window.__fp, P = window.__app.pad;
      f.step(2, 1 / 60, false);
      const list = document.querySelector('.settings-content'); const r = list.getBoundingClientRect();
      list.scrollTop = 0;
      f.tap('r3', false);
      P.cursor.x = r.left + r.width / 2; P.cursor.y = r.top + r.height / 2; f.tap('right', false);
      await new Promise((res) => setTimeout(res, 150));
      f.axes(0, 0, 0, 1);
      for (let i = 0; i < 12; i++) { f.step(1, 1 / 60, false); await new Promise((res) => setTimeout(res, 60)); }
      f.axes(0, 0, 0, 0); f.step(1, 1 / 60, false);
      await new Promise((res) => setTimeout(res, 400));
      const top = list.scrollTop;
      f.tap('b', false);
      return { top };
    });
    check('the right stick turns the wheel under the pointer (the list scrolls down)', wheel.top > 60, wheel);
    await fp(() => window.__app.closeAllPanels()); await sleep(800);
  }

  // ================================================================= 10c. the podcast player, every other panel ===================
  if (want('podcasts')) {
    // a silent episode (as in hud-check)
    await cc(() => {
      const rate = 8000, secs = 240, n = rate * secs;
      const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); wr(36, 'data'); v.setUint32(40, n * 2, true);
      const ep = { id: 'cc-test-ep', title: 'Folge 7: Cozy Shelves am Abend', audio: URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })), duration: secs };
      globalThis.__cozyshelvesPodcastPlayer.attach(window.__app.ctx);
      globalThis.__cozyshelvesPodcastPlayer.play(ep, { title: 'Testpodcast', artwork: '', feedUrl: '', author: 'Cozy Shelves' });
    });
    await page.waitForFunction(() => { const a = globalThis.__cozyshelvesPodcastPlayer.audio; return !a.paused && a.currentTime > 0.2; }, null, { timeout: 15000 }).catch(() => {});
    await cc(() => window.__app.ctx.openPanel('podcasts', {}));
    await sleep(1500);
    const pod = await fp(async () => {
      const f = window.__fp, P = window.__app.pad, a = globalThis.__cozyshelvesPodcastPlayer.audio, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      f.tap('l3', false); f.step(2, 1 / 60, false);
      const onPlayer = !!P.nav.el?.classList.contains('pod-player'), ring = f.ring().show;
      f.tap('a', false); await wait(300); const paused = a.paused;
      f.tap('a', false); await wait(300); const playing = !a.paused;
      const t0 = a.currentTime; f.tap('right', false); await wait(300); const t1 = a.currentTime;
      f.tap('left', false); await wait(300); const t2 = a.currentTime;
      f.tap('down', false); f.step(2, 1 / 60, false);
      const into = P.nav.el?.className || '';
      return { onPlayer, ring, paused, playing, fwd: +(t1 - t0).toFixed(1), back: +(t1 - t2).toFixed(1), into };
    });
    check('podcasts: the ring starts on the player, A pauses and plays', pod.onPlayer && pod.ring && pod.paused && pod.playing, pod);
    check('podcasts: right and left seek 15 s, down leads to its play button', pod.fwd >= 13 && pod.back >= 13 && /pod-ctl/.test(pod.into) && /main/.test(pod.into), pod);
    await shot('cc-14-podcast-player');
    const podB = await fp(async () => { const f = window.__fp; for (let i = 0; i < 3 && f.panels().includes('podcasts'); i++) { f.tap('b', false); await new Promise((r) => setTimeout(r, 500)); f.step(2, 1 / 60, false); } return f.panels(); });
    check('B closes the podcasts (the episode plays on)', !podB.includes('podcasts'), podB);
    await cc(() => globalThis.__cozyshelvesPodcastPlayer.stop());
    await sleep(600);
  }
  if (want('panels')) {
    // every other panel: the ring finds a place to start, the D-pad moves it, B closes, no error
    const names = ['basket', 'records', 'gallery', 'watercolor', 'news', 'wiki', 'catalog', 'computer', 'browser', 'chess', 'mediathek', 'worldmap', 'bookinfo'];
    const out = {};
    for (const name of names) {
      await cc((name) => {
        const p = name === 'bookinfo' ? { id: window.__app.state.library.books[0]?.id } : name === 'gallery' ? { slot: 1 } : {};
        window.__app.ctx.openPanel(name, p);
      }, name);
      await sleep(name === 'browser' || name === 'worldmap' || name === 'mediathek' ? 3500 : 1800);
      out[name] = await fp(async (name) => {
        const f = window.__fp, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        f.tap('l3', false); f.step(3, 1 / 60, false);
        const r0 = f.ring();
        f.tap('down', false); f.step(2, 1 / 60, false); f.tap('right', false); f.step(2, 1 / 60, false);
        const r1 = f.ring();
        let closed = false;
        for (let i = 0; i < 4 && !closed; i++) { f.tap('b', false); await wait(500); f.step(2, 1 / 60, false); closed = !f.panels().includes(name); }
        return { start: r0.on, show: r0.show || r0.tag === 'CANVAS', moved: r1.on, closed, input: document.documentElement.dataset.input || 'keys' };
      }, name);
      await sleep(700);
    }
    const bad = Object.entries(out).filter(([, r]) => !(r.start && r.closed && r.input === 'pad'));
    check('every panel: the ring finds a start, B closes it (' + names.join(', ') + ')', bad.length === 0, bad.length ? bad : Object.fromEntries(Object.entries(out).map(([k, r]) => [k, r.start])));
    await fp(() => window.__app.closeAllPanels()); await sleep(600);
  }

  // ================================================================= 11. PlayStation ===============================================
  if (want('ps')) {
    const ps = await fp(async () => {
      const f = window.__fp, P = window.__app.pad;
      f.disconnect(); await new Promise((r) => setTimeout(r, 300));
      f.connect('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'); await new Promise((r) => setTimeout(r, 300));
      P.paused = true;
      f.tap('l3'); f.tap('l3');
      const e = f.book(); f.aimBook(e);
      await new Promise((r) => setTimeout(r, 500));
      return { card: [...document.querySelectorAll('#book-peek .peek-keys kbd')].map((k) => k.textContent), basket: document.querySelector('#basket-hud .bk-key kbd')?.textContent };
    });
    check('a PlayStation pad: the cross for A, L1 and R1 for the shoulders, the triangle for the basket', ps.card.slice(0, 3).join(' ') === '✕ L1 R1' && ps.basket === '△', ps);
    await fp(() => window.__app.world.frame());
    await shot('cc-10-hud-playstation');
  }

  // ================================================================= 11b. English, the lists of buttons =========================
  if (want('english')) {
    // the settings in German: the list of the buttons (scrolled into view)
    await cc(() => window.__app.ctx.openPanel('settings', { section: 'controller' }));
    await sleep(1200);
    const de = await fp(async () => {
      const f = window.__fp; f.tap('l3', false); f.step(2, 1 / 60, false);
      const list = document.querySelector('.pad-lists'); list?.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 300));
      return { rows: [...document.querySelectorAll('.pad-row')].map((r) => r.textContent.trim()).slice(0, 3), glyphs: document.querySelectorAll('.pad-row kbd.pad').length };
    });
    check('Einstellungen → Controller lists the buttons with their glyphs', de.rows.length === 3 && de.glyphs >= 20, de);
    await shot('cc-12-settings-buttons');
    // English: the card, the settings
    await cc(() => window.__app.ctx.api.settings.set({ language: 'en' }));
    await sleep(900);
    const en = await fp(async () => {
      const f = window.__fp, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const s = { tab: document.querySelector('.settings-nav button.active')?.textContent || '', labels: [...document.querySelectorAll('.settings-content .setting > label')].map((l) => l.firstChild?.textContent || '').slice(0, 3), status: document.querySelector('.pad-status')?.textContent || '' };
      window.__app.closeAllPanels(); await wait(700);
      f.tap('l3'); f.tap('l3');
      const e = f.book(); f.aimBook(e); await wait(500);
      // the words beside the glyphs (the glyphs follow the pad: this one may be a PlayStation pad by now)
      const words = (el) => [...(el?.childNodes || [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();
      const card = [...document.querySelectorAll('#book-peek .peek-keys > span')].map(words);
      const glyphs = document.querySelectorAll('#book-peek .peek-keys kbd.pad').length;
      const basket = words(document.querySelector('#basket-hud .bk-key'));
      return { s, card, glyphs, basket };
    });
    check('English: the settings section (Controller, Sensitivity, Invert Y, Connected)', en.s.tab === 'Controller' && en.s.labels.includes('Sensitivity') && en.s.labels.includes('Invert Y') && /Connected/.test(en.s.status), en.s);
    check('English: the book card "Into the basket · Read · Info · Next book" with the glyphs of the pad, the basket "Open the basket"', en.card.join(' · ') === 'Into the basket · Read · Info · Next book' && en.glyphs === 4 && en.basket === 'Open the basket', en);
    await fp(() => window.__app.world.frame());
    await shot('cc-13-english-card');
    await cc(() => window.__app.ctx.api.settings.set({ language: 'de' }));
    await sleep(900);
  }

  // ================================================================= 12. in the running loop =======================================
  if (want('live')) {
    await fp(() => { const f = window.__fp; f.aim(-0.8, 3.2, -0.8, 1.62, -3); window.__app.pad.paused = false; window.__app.world.start(); });
    await sleep(800);
    const walkLive = () => fp(async () => {
      const f = window.__fp, p = window.__app.world.player;
      const z0 = p.position.z;
      const gaps = []; let last = performance.now(), run = true;
      const tick = (t) => { gaps.push(t - last); last = t; if (run) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      f.axes(0, -1);
      await new Promise((r) => setTimeout(r, 1000));
      f.axes(0, 0);
      await new Promise((r) => setTimeout(r, 400));
      run = false;
      return { moved: +(z0 - p.position.z).toFixed(2), maxGap: +Math.max(...gaps.slice(2)).toFixed(1) };
    });
    // (other programs share the graphics card during test runs: after a stall of a few hundred ms the walk is measured again)
    let live = await walkLive();
    if (live.maxGap > 100) { await fp(() => window.__fp.aim(-0.8, 3.2, -0.8, 1.62, -3)); await sleep(500); live = { ...(await walkLive()), first: live }; }
    check('in the running loop: the stick walks the player (about 2.4 m in a second)', live.moved > 1.8 && live.moved < 3.2, live);
    const cost = await fp(() => {
      const f = window.__fp, P = window.__app.pad; P.paused = true; window.__app.world.stop();
      f.aim(-0.8, 1.4, -0.8, 1.62, -3); f.axes(0, -0.6, 0.4, 0);
      const t0 = performance.now(); for (let i = 0; i < 300; i++) P.step(1 / 60); const ms = (performance.now() - t0) / 300;
      f.axes(0, 0, 0, 0); f.step(10);
      return { msPerPoll: +ms.toFixed(4) };
    });
    check('one poll of the pad costs well under a tenth of a millisecond in the world', cost.msPerPoll < 0.1, cost);
  }

  // ================================================================= 13. disconnect =================================================
  const gone = await fp(async () => {
    const f = window.__fp, P = window.__app.pad;
    P.paused = false;
    f.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    const calls0 = f.calls;
    await new Promise((r) => setTimeout(r, 1500));
    return { raf: P.raf, input: document.documentElement.dataset.input || null, calls: f.calls - calls0, player: window.__app.world.player.pad };
  });
  check('the pad disconnects: the loop stops, nothing polls any more, the keys come back', !gone.raf && gone.calls === 0 && gone.input === null && gone.player === null, gone);

  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`CONTROLLER-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
