// The world map the way a person uses it, with real input only: Playwright's mouse, wheel and keyboard (trusted
// events through the DevTools protocol) from the start screen through the hall and the passage to the map in the book
// room, into the panel (drag, wheel, keys, countries big and small, cities, the card, Wikipedia, Street View, search,
// back and forward with the buttons, Alt+arrows and the mouse's side buttons), Esc back into the world, and all of it
// a second time. The script only reads the app's state to find its way (positions, what lies under the cursor); it
// never calls the app to act.
//   COZYSHELVES_BOOKS=<library>|structured COZYSHELVES_USERDATA=<dir> SHOT_DIR=<dir> node build/screenshot.js worldmap-real-check
// Env: WM_W, WM_H the window's inner size (default 2560 × 1440, a common large display; the window stays left of
// every display), WM_NET=0 leaves out Wikipedia and Street View, WM_RUNS (default 2).
//
// Pointer lock: Chromium grants it only to a focused window, and the hidden test window never takes the focus (it would
// take the keyboard from the person at the computer). A stand-in replaces the three entry points of the Pointer Lock API
// before the first click and behaves like Chromium: while locked, every mouse event goes to the locked element and
// carries the movement; exitPointerLock() unlocks and the cursor returns to where it was caught; Chromium's own
// re-centering of the hidden cursor moves nothing. If the app forgot to release the mouse, clicks into a panel would
// land on the 3D view exactly as in the real app.
// The map (Leaflet, osm-view.js) is an atlas of the app's own data in the overview with a switch of its views at the
// bottom; from zoom 8.5 on OpenStreetMap's tiles show. They never come from tile.openstreetmap.org here:
// build/scripts/osm-tiles.js answers every tile request with a small PNG of its own.
const path = require('path');
const fs = require('fs');
const { serveTiles } = require('./osm-tiles.js');

module.exports = async ({ app, page, shot, sleep }) => {
  const dir = process.env.SHOT_DIR || path.join(__dirname, '..', '..', 'shots');
  const W = +process.env.WM_W || 2560, H = +process.env.WM_H || 1440;
  const NET = process.env.WM_NET !== '0';
  const RUNS = Math.max(1, +process.env.WM_RUNS || 2);
  const results = [];
  const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); return !!cond; };
  const info = (name, detail) => console.log(`INFO ${name} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  const tiles = await serveTiles({ page, app });
  const errors = [];
  // a resource that fails is left to the parts that need the network, a tile that fails is an error
  const ignore = [/root document of this element is not valid for pointer lock/i, /THREE\.Clock/, /Invalid guestInstanceId/];
  page.on('pageerror', (e) => { if (!ignore.some((r) => r.test(e.message))) errors.push('pageerror: ' + e.message.slice(0, 240)); });
  page.on('console', (m) => {
    if (m.type() !== 'error' || ignore.some((r) => r.test(m.text()))) return;
    const url = m.location()?.url || '';
    if (/net::ERR_|Failed to load resource/.test(m.text()) && !url.includes(tiles.HOST)) return;
    errors.push('console: ' + m.text().slice(0, 200) + (url ? ' ' + url.slice(0, 80) : ''));
  });
  page.on('requestfailed', (r) => { if (r.url().includes(tiles.HOST) && !/ERR_ABORTED/.test(r.failure()?.errorText || '')) errors.push(`tile failed: ${r.url()} ${r.failure()?.errorText}`); });
  const mainErrors = [];
  app.process().stderr?.on('data', (d) => { for (const l of String(d).split(/\r?\n/)) if (/\b(error|uncaught|exception)\b/i.test(l) && !/Debugger|DevTools|GPU process|gpu_|ssl_client|handshake|net_error|cert/i.test(l)) mainErrors.push(l.slice(0, 200)); });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wm = (fn, arg) => page.evaluate(([f, a]) => { const w = document.querySelector('.wm-panel')?.__wm; if (!w) return null; return new Function('w', 'a', `return (${f})(w, a)`)(w, a); }, [fn.toString(), arg ?? null]);
  const until = async (label, fn, timeout = 20000, step = 200) => {
    const t0 = Date.now(); let last = null;
    while (Date.now() - t0 < timeout) { try { last = await fn(); if (last) return last; } catch (e) { last = { err: e.message }; } await sleep(step); }
    console.log(`  (timeout waiting for ${label}: ${JSON.stringify(last)?.slice(0, 240)})`);
    return null;
  };
  const snap = async (name) => {
    try {
      const b64 = await app.evaluate(async ({ BrowserWindow, webContents }) => {
        const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
        const all = [w.webContents, ...webContents.getAllWebContents().filter((x) => x.getType() === 'webview')];
        for (const c of all) { try { c.incrementCapturerCount(undefined, false, false); } catch {} }
        try { w.webContents.invalidate(); await new Promise((r) => setTimeout(r, 600)); return (await w.webContents.capturePage()).toPNG().toString('base64'); }
        finally { for (const c of all) { try { if (!c.isDestroyed()) c.decrementCapturerCount(false, false); } catch {} } }
      });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
      console.log('shot', name);
    } catch (e) { console.log('shot failed', name, e.message); }
  };

  // ---- the window: as large as a 2560 × 1440 display, left of every display ---------------------------------------
  const win = await app.evaluate(async ({ BrowserWindow, screen }, a) => {
    const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
    const minX = Math.min(0, ...screen.getAllDisplays().map((d) => d.bounds.x));
    w.setMinimumSize(800, 600);
    w.setContentBounds({ x: minX - a.W - 600, y: 0, width: a.W, height: a.H });
    await new Promise((r) => setTimeout(r, 400));
    // Windows may hand out a little more than asked for (the frame): correct once by the difference
    const got = w.getContentBounds();
    if (got.width !== a.W || got.height !== a.H) { const b = w.getBounds(); w.setBounds({ x: minX - a.W - 600, y: 0, width: b.width - (got.width - a.W), height: b.height - (got.height - a.H) }); await new Promise((r) => setTimeout(r, 400)); }
    return { content: w.getContentBounds(), displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, scale: d.scaleFactor })) };
  }, { W, H });
  const vp = await until('window size', async () => { const v = await ev(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })); return v.w >= W - 2 ? v : null; }, 8000) || await ev(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  info('Fenster', { inner: vp, ...win });
  ok(`Fenster ${W}×${H} (außerhalb aller Bildschirme)`, vp.w >= W - 2 && vp.h >= H - 2 && win.displays.every((d) => win.content.x + win.content.width <= d.bounds.x || win.content.x >= d.bounds.x + d.bounds.width), vp);

  // ---- pointer lock as in Chromium (see above) ---------------------------------------------------------------------------
  await page.waitForFunction(() => document.readyState !== 'loading');
  await ev(() => {
    if (window.__pl) return;
    const S = window.__pl = { el: null, at: [0, 0], pos: [0, 0], skip: 0, log: [], locks: 0, unlocks: 0, redirected: 0 };
    const fire = (type) => document.dispatchEvent(new Event(type));
    Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return S.el; } });
    Element.prototype.requestPointerLock = function () {
      const el = this;
      S.log.push(['request', el.id || el.tagName, !!navigator.userActivation?.isActive, Math.round(performance.now())]);
      if (!el.isConnected) { setTimeout(() => fire('pointerlockerror')); return Promise.reject(new DOMException('not connected', 'WrongDocumentError')); }
      return new Promise((resolve) => setTimeout(() => {
        if (S.el !== el) { S.el = el; S.at = S.pos.slice(); S.locks++; fire('pointerlockchange'); }
        resolve();
      }, 0));
    };
    Document.prototype.exitPointerLock = function () {
      S.log.push(['exit', !!S.el, Math.round(performance.now())]);
      if (!S.el) return;
      setTimeout(() => { if (!S.el) return; S.el = null; S.unlocks++; fire('pointerlockchange'); }, 0);
    };
    let last = null;
    const MOUSE = ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'mousemove', 'wheel', 'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave'];
    for (const type of MOUSE) {
      window.addEventListener(type, (e) => {
        if (!e.isTrusted) return;
        if (type === 'mousemove') S.pos = [e.clientX, e.clientY];
        if (!S.el) { if (type === 'mousemove') last = [e.clientX, e.clientY]; return; }
        // locked: Chromium sends everything to the locked element; enter/leave/over/out do not happen. A pointer
        // event is not cancelled: a cancelled pointerdown would swallow the mousedown that follows it
        e.stopImmediatePropagation();
        if (!(e instanceof PointerEvent)) e.preventDefault();
        if (/over|out|enter|leave/.test(type)) return;
        let mx = 0, my = 0;
        if (type === 'mousemove' || type === 'pointermove') {
          if (type === 'mousemove') {
            if (S.skip > 0) { S.skip--; last = [e.clientX, e.clientY]; return; }   // the hidden cursor is re-centred
            mx = last ? e.clientX - last[0] : 0; my = last ? e.clientY - last[1] : 0; last = [e.clientX, e.clientY];
          } else return;                                                             // pointermove: the app uses mousemove
        }
        const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: S.at[0], clientY: S.at[1], screenX: e.screenX, screenY: e.screenY, movementX: mx, movementY: my, button: e.button, buttons: e.buttons, detail: e.detail, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey };
        let copy;
        if (e instanceof WheelEvent) copy = new WheelEvent(type, { ...init, deltaX: e.deltaX, deltaY: e.deltaY, deltaMode: e.deltaMode });
        else if (e instanceof PointerEvent) copy = new PointerEvent(type, { ...init, pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary });
        else copy = new MouseEvent(type, init);
        S.redirected++;
        S.el.dispatchEvent(copy);
      }, { capture: true, passive: false });
    }
  });

  // ---- real input helpers ---------------------------------------------------------------------------------------------
  const cur = { x: W / 2, y: H / 2 };
  const mouseTo = async (x, y, steps = 1) => { await page.mouse.move(x, y, { steps }); cur.x = x; cur.y = y; };
  const click = async (x, y, opts = {}) => { await mouseTo(x, y, opts.steps || 6); await sleep(opts.hover ?? 60); await page.mouse.down(); await sleep(opts.hold ?? 70); await page.mouse.up(); await sleep(opts.after ?? 120); };
  const rectOf = (sel) => ev((s) => { const el = typeof s === 'string' ? document.querySelector(s) : null; if (!el) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  const clickSel = async (sel, opts) => { const r = await rectOf(sel); if (!r) return false; await click(r.x, r.y, opts); return true; };
  /** a button found by its text */
  const clickText = async (sel, re, opts) => {
    const r = await ev(([s, src]) => { const rx = new RegExp(src, 'i'); const el = [...document.querySelectorAll(s)].find((x) => rx.test(x.textContent || '') && x.getBoundingClientRect().width > 0); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, [sel, re.source]);
    if (!r) return false; await click(r.x, r.y, opts); return true;
  };
  /** a button in the card, found by its text: the card is scrolled with the mouse wheel until the button is in sight */
  const clickInCard = async (re) => {
    for (let i = 0; i < 12; i++) {
      const r = await ev((src) => {
        const card = document.querySelector('.wm-card'); if (!card || card.hidden) return null;
        const c = card.getBoundingClientRect(), rx = new RegExp(src, 'i');
        const el = [...card.querySelectorAll('button')].find((x) => rx.test(x.textContent || '')); if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, inside: b.top >= c.top + 4 && b.bottom <= c.bottom - 4, card: { x: c.left + c.width / 2, y: c.top + c.height / 2, below: b.top > c.bottom - 4 } };
      }, re.source);
      if (!r) return false;
      if (r.inside) { await click(r.x, r.y); return true; }
      await mouseTo(r.card.x, r.card.y, 3); await page.mouse.wheel(0, r.card.below ? 240 : -240); await sleep(250);
    }
    return false;
  };
  const key = async (k, hold = 40) => { await page.keyboard.down(k); await sleep(hold); await page.keyboard.up(k); await sleep(60); };
  const combo = async (mod, k) => { await page.keyboard.down(mod); await sleep(30); await page.keyboard.down(k); await sleep(40); await page.keyboard.up(k); await sleep(20); await page.keyboard.up(mod); await sleep(120); };
  let cdp = null;
  try { cdp = await page.context().newCDPSession(page); } catch (e) { info('CDP', 'keine Sitzung: ' + e.message); }
  /** the mouse's side buttons: 'back' (4) and 'forward' (5) */
  const sideButton = async (button) => {
    if (!cdp) return false;
    const base = { x: cur.x, y: cur.y, button, clickCount: 1, pointerType: 'mouse' };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons: button === 'back' ? 8 : 16 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons: 0 });
    await sleep(150);
    return true;
  };

  // ---- the player: turning with the mouse, walking with W -------------------------------------------------------------
  let RAD_PER_PX = 0.0022;    // player.js: yaw -= movementX · 0.0022 · sensitivity (set again once the settings are in)
  const pose = () => ev(() => { const p = window.__app.world.player; return { x: p.position.x, z: p.position.z, yaw: p.yaw, pitch: p.pitch, locked: p.locked, enabled: p.enabled, transition: !!p.transition }; });
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const recenter = async () => { await ev(() => { window.__pl.skip = 1; }); await mouseTo(W / 2, H / 2); };
  /** turn the view by dyaw, dpitch (radians) the way a hand moves the mouse: small steps */
  const turn = async (dyaw, dpitch = 0) => {
    let dx = -dyaw / RAD_PER_PX, dy = -dpitch / RAD_PER_PX;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 30));
    for (let i = 0; i < n; i++) {
      const sx = dx / (n - i), sy = dy / (n - i);
      if (cur.x + sx < 80 || cur.x + sx > W - 80 || cur.y + sy < 80 || cur.y + sy > H - 80) await recenter();
      await mouseTo(cur.x + sx, cur.y + sy);
      dx -= sx; dy -= sy;
      await sleep(6);
    }
  };
  const lookAt = async (x, y, z) => {
    for (let i = 0; i < 3; i++) {
      const p = await pose();
      const yaw = Math.atan2(-(x - p.x), -(z - p.z)), pitch = Math.atan2(y - 1.62, Math.hypot(x - p.x, z - p.z));
      const dy = wrap(yaw - p.yaw), dp = pitch - p.pitch;
      if (Math.abs(dy) < 0.01 && Math.abs(dp) < 0.01) return;
      await turn(dy, dp);
      await sleep(60);
    }
  };
  /** a walkable route on a 0.2 m grid around the colliders (the script reads them, it does not move the player) */
  const route = async (tx, tz) => {
    const g = await ev(() => { const w = window.__app.world; return { cols: w.colliders.filter((c) => !(c.max[1] < 0.25 || c.min[1] > 1.62)).map((c) => [c.min[0], c.min[2], c.max[0], c.max[2]]), p: [w.player.position.x, w.player.position.z] }; });
    const STEP = 0.2, R = 0.46, X0 = -12, Z0 = -24.5, NX = 125, NZ = 160;
    const free = new Uint8Array(NX * NZ);
    for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
      const x = X0 + i * STEP, z = Z0 + j * STEP;
      free[i * NZ + j] = g.cols.every(([a, b, c, d]) => { const cx = Math.max(a, Math.min(x, c)), cz = Math.max(b, Math.min(z, d)); return (x - cx) ** 2 + (z - cz) ** 2 >= R * R; }) ? 1 : 0;
    }
    const cell = (x, z) => [Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP)];
    const [si, sj] = cell(g.p[0], g.p[1]), [ti, tj] = cell(tx, tz);
    free[si * NZ + sj] = 1; free[ti * NZ + tj] = 1;
    const dist = new Float32Array(NX * NZ).fill(Infinity), prev = new Int32Array(NX * NZ).fill(-1), done = new Uint8Array(NX * NZ);
    const open = [[0, si * NZ + sj]]; dist[si * NZ + sj] = 0;
    const goal = ti * NZ + tj;
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, u] = open.splice(bi, 1)[0];
      if (done[u]) continue; done[u] = 1;
      if (u === goal) break;
      const ui = Math.floor(u / NZ), uj = u % NZ;
      for (const [di, dj, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const vi = ui + di, vj = uj + dj; if (vi < 0 || vj < 0 || vi >= NX || vj >= NZ) continue;
        const v = vi * NZ + vj; if (!free[v] || done[v]) continue;
        const nd = dist[u] + c;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; open.push([nd + Math.hypot(vi - ti, vj - tj), v]); }
      }
    }
    if (prev[goal] < 0 && goal !== si * NZ + sj) return null;
    const pts = []; for (let u = goal; u >= 0; u = prev[u]) pts.push([X0 + Math.floor(u / NZ) * STEP, Z0 + (u % NZ) * STEP]);
    pts.reverse();
    // keep only the corners: a point is dropped while the straight line to the next one stays on free cells
    const clear = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.08); for (let k = 0; k <= n; k++) { const [i, j] = cell(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (!free[i * NZ + j]) return false; } return true; };
    const out = [pts[0]]; let k = 0;
    while (k < pts.length - 1) { let m = pts.length - 1; while (m > k + 1 && !clear(pts[k], pts[m])) m--; out.push(pts[m]); k = m; }
    out[out.length - 1] = [tx, tz];
    return out.slice(1);
  };
  const walkTo = async (tx, tz, tol = 0.3) => {
    const pts = await route(tx, tz);
    if (!pts) { info('Weg', `kein Weg nach ${tx}, ${tz}`); return false; }
    for (const [x, z] of pts) {
      let p = await pose();
      await turn(wrap(Math.atan2(-(x - p.x), -(z - p.z)) - p.yaw), -p.pitch);
      const t0 = Date.now(), limit = Math.hypot(x - p.x, z - p.z) / 2.4 * 2000 + 2500;
      let best = Infinity, stuck = Date.now(), side = 0;
      await page.keyboard.down('KeyW');
      try {
        while (Date.now() - t0 < limit) {
          await sleep(70);
          p = await pose();
          const d = Math.hypot(x - p.x, z - p.z);
          if (d < (x === tx && z === tz ? tol : 0.45)) break;
          const err = wrap(Math.atan2(-(x - p.x), -(z - p.z)) - p.yaw);
          if (Math.abs(err) > 0.04) await turn(err, 0);
          if (d < best - 0.03) { best = d; stuck = Date.now(); }
          else if (Date.now() - stuck > 1200) { const k = side++ % 2 ? 'KeyA' : 'KeyD'; await page.keyboard.down(k); await sleep(350); await page.keyboard.up(k); stuck = Date.now(); }
        }
      } finally { await page.keyboard.up('KeyW'); }
    }
    await sleep(500);
    const p = await pose();
    return Math.hypot(tx - p.x, tz - p.z) < tol + 0.25;
  };

  // ---- map helpers (reading the panel's state to find a place on the screen) -------------------------------------------
  const mapState = () => wm((w) => w.state());
  // The map's knowledge (data.js) is in the units of its projection: the projection there and back in the page, and
  // Leaflet's word on when a movement starts and ends (settle)
  const prepareMap = () => ev(() => {
    const m = document.querySelector('.wm-panel').__wm.view.map;
    if (!m.__hooked) { m.__hooked = true; m.__moving = false; m.on('movestart', () => { m.__moving = true; }); m.on('moveend', () => { m.__moving = false; }); }
    if (window.__wmProj) return;
    const DEG = Math.PI / 180;
    const project = (lon, lat) => { const l = lon * DEG, p = lat * DEG, p2 = p * p, p4 = p2 * p2; return [l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))), -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))]; };
    const unproject = (x, y) => {
      const yy = -y; let p = yy;
      for (let i = 0; i < 12; i++) { const p2 = p * p, p4 = p2 * p2; const f = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))) - yy; const d = 1.007226 + p2 * (3 * 0.015085 + p4 * (-7 * 0.044475 + 9 * 0.028874 * p2 - 11 * 0.005916 * p4)); p -= f / d; }
      const p2 = p * p, p4 = p2 * p2; const k = 0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4));
      return [x / k / DEG, p / DEG];
    };
    // a world point of data.js → container px of the map, and the country under a container point (no tolerance)
    const toScreen = (w, x, y) => { const [lon, lat] = unproject(x, y); return w.view.map.latLngToContainerPoint([lat, lon]); };
    const countryUnder = (w, px, py) => { const ll = w.view.map.containerPointToLatLng([px, py]); const [x, y] = project(((ll.lng + 540) % 360) - 180, ll.lat); return w.data.countryAt(x, y); };
    /** the distance (px) from a container point to the nearest city that answers the pointer at this zoom */
    const cityDist = (w, px, py) => { const m = w.view.map, z = m.getZoom(), b = m.getBounds().pad(0.05); let d = 99; for (const c of w.data.places) { if (c.minZoom > z + 0.5 || !b.contains([c.lat, c.lon])) continue; const q = m.latLngToContainerPoint([c.lat, c.lon]); d = Math.min(d, Math.hypot(q.x - px, q.y - py)); } return d; };
    /** what lies on top of the map (a click there would not reach it) */
    const covered = (px, py) => [...document.querySelectorAll('.wm-card:not([hidden]), .wm-zoom, .wm-legend:not([hidden]), .wm-osm .leaflet-control, .wm-offline:not([hidden])')].some((e) => { const r = e.getBoundingClientRect(); return px >= r.left - 6 && px <= r.right + 6 && py >= r.top - 6 && py <= r.bottom + 6; });
    window.__wmProj = { project, unproject, toScreen, countryUnder, cityDist, covered };
  });
  /** the map stands still (no flight, zoom or pan, the same view twice in a row) and its tiles are in */
  const settle = async () => {
    let prev = '';
    await until('map at rest', async () => {
      const s = await wm((w) => { const m = w.view.map; return JSON.stringify([m.getZoom(), m.getCenter(), !!m._animatingZoom, !!(m._panAnim && m._panAnim._inProgress), !!m.__moving]); });
      const still = !!s && s === prev && !/true/.test(s); prev = s; return still;
    }, 8000, 100);
    await until('tiles in', () => wm((w) => !w.view.tiles.isLoading()), 8000, 100);
    await sleep(150);
  };
  /** the whole world in view: the map's box holds the inhabited world */
  const wholeWorld = () => wm((w) => { const b = w.view.map.getBounds(); return b.getWest() <= -160 && b.getEast() >= 175 && b.getSouth() <= -50 && b.getNorth() >= 70; });
  /** page position of a country's inner point: inside its main part, as far from every city that answers as possible
   *  (and not at the edge of the view, not under the card or the buttons) */
  const countryPoint = (id) => wm((w, id) => {
    const P = window.__wmProj, c = w.data.byId.get(id), r = w.view.el.getBoundingClientRect(), size = w.view.map.getSize();
    const main = c.parts.reduce((a, b) => (b.area > a.area ? b : a));
    const [x0, y0, x1, y1] = main.bbox;
    let best = null;
    for (let i = 1; i < 20; i++) for (let j = 1; j < 20; j++) {
      const s = P.toScreen(w, x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * j / 20);
      if (s.x < 30 || s.y < 30 || s.x > size.x - 30 || s.y > size.y - 30 || P.covered(r.left + s.x, r.top + s.y) || P.countryUnder(w, s.x, s.y) !== c) continue;
      const dd = Math.min(60, P.cityDist(w, s.x, s.y));
      if (!best || dd > best[2]) best = [r.left + s.x, r.top + s.y, +dd.toFixed(1)];
    }
    return best;
  }, id);
  const cityPoint = (name) => wm((w, n) => { const p = w.data.places.find((x) => x.name === n || x.de === n); if (!p) return null; const q = w.view.map.latLngToContainerPoint([p.lat, p.lon]); const r = w.view.el.getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }, name);
  /** what the map shows under the mouse: the hovered country or city, the cursor of the element there */
  const hoverState = (x, y) => ev(([x, y]) => { const w = document.querySelector('.wm-panel').__wm, k = w.view.hoverKey || ''; const el = document.elementFromPoint(x, y); return { hover: k[0] === 'k' ? w.data.countries[+k.slice(1)].id : k[0] === 'c' ? w.data.places[+k.slice(1)].name : null, cursor: el ? getComputedStyle(el).cursor : null, pointing: w.view.el.classList.contains('pointing') }; }, [x, y]);
  const tipText = () => ev(() => { const t = document.querySelector('.wm-tip'); return t && !t.hidden ? t.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const cardText = () => ev(() => { const c = document.querySelector('.wm-card'); return c && !c.hidden ? c.innerText.replace(/\s+/g, ' ') : ''; });
  const sel = async () => (await mapState())?.sel || null;
  const panelOpen = () => ev(() => !!document.querySelector('.panel-layer.open .wm-panel'));
  const lockState = () => ev(() => ({ el: document.pointerLockElement ? document.pointerLockElement.id || document.pointerLockElement.tagName : null, locked: window.__app.world.player.locked, redirected: window.__pl.redirected, locks: window.__pl.locks, unlocks: window.__pl.unlocks }));
  /** WCAG contrast of an element's text against the colour behind it */
  const contrast = (selector) => ev((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const parse = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : null; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let bg = null; for (let o = el; o && !bg; o = o.parentElement) { const c = parse(getComputedStyle(o).backgroundColor); if (c && (c[3] ?? 1) > 0.5) bg = c; }
    const fg = parse(getComputedStyle(el).color);
    if (!bg || !fg) return null;
    const a = lum(fg), b = lum(bg);
    return +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
  }, selector);

  // ============================================================================== start screen → library ==========
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await sleep(400);
  const entered = await clickSel('.menu-btn.primary');
  await until('menu closed', () => ev(() => !document.querySelector('.panel-layer.menu-layer:not(.closing)') && window.__app.state.entered), 10000);
  ok('Echter Klick auf „Bücherei betreten“ öffnet die Bücherei', entered && await ev(() => window.__app.state.entered));
  RAD_PER_PX = 0.0022 * (await ev(() => window.__app.world.player.sensitivity || 1));
  for (let i = 0; i < 160; i++) { const s = await ev(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active })); if (!s.active && s.n > 0) break; await sleep(3000); }
  await sleep(1500);
  info('Bücherei', await ev(() => ({ books: window.__app.state.library.books.length, departments: window.__app.state.library.departments.length, all: window.__app.world.layout.allDepartments, scan: window.__app.state.library.scan })));
  // the app catches the mouse itself after entering; a click into the view catches it otherwise
  let ls = await until('pointer caught', async () => { const s = await lockState(); return s.locked ? s : null; }, 3000);
  if (!ls) { await click(W / 2, H / 2); ls = await until('pointer caught after a click', async () => { const s = await lockState(); return s.locked ? s : null; }, 3000); }
  ok('Die Maus ist gefangen (Umsehen mit der Maus)', !!ls?.locked, ls || await lockState());

  // ============================================================================== to the map and into it, twice ===
  const MAP = { x: -6.1, y: 1.95, z: -23.55 };
  // a place on the painted wall map in the room: the projection of data.js and the sheet's layout of worldmap-prop.js
  // (3.6 × 2.1 m, the world 94 % of its width, its middle at 52.5 % of the height)
  const onWall = (lon, lat) => {
    const DEG = Math.PI / 180, l = lon * DEG, p = lat * DEG, p2 = p * p, p4 = p2 * p2;
    const x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    const y = -p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    const k = 0.94 / (2 * Math.PI * 0.8707), u = 0.5 + x * k, v = 1 - (0.525 + y * k * (3.6 / 2.1));
    return { x: MAP.x + (u - 0.5) * 3.6, y: MAP.y + (v - 0.5) * 2.1, z: MAP.z };
  };
  for (let run = 1; run <= RUNS; run++) {
    const R = (s) => `Durchgang ${run}: ${s}`;
    // ---- find the map --------------------------------------------------------------------------------------------
    if (run === 1) {
      const p0 = await pose();
      info(R('Start'), p0);
      // a few steps in front of the map, where one stands to look at a map of 3.7 m: about 4 m from the wall
      const arrived = await walkTo(-6.1, -19.4);
      const p1 = await pose();
      ok(R('Mit W und der Maus durch Halle und Durchgang bis gut 4 m vor die Weltkarte gegangen'), arrived, { ...p1, toWall: +(p1.z - MAP.z).toFixed(2) });
    } else {
      // the places menu (G)
      await key('KeyG');
      await until('places menu', () => ev(() => !!document.querySelector('.panel-layer.open .place-grid')), 5000);
      await sleep(300);
      await snap(`wmr-${run}-orte`);
      const viaPlace = await clickText('.place-grid .place', /^Weltkarte$/);
      ok(R('Orte (G) führt zur Weltkarte'), viaPlace, viaPlace ? '' : await ev(() => [...document.querySelectorAll('.place-grid .place')].map((b) => b.textContent).join(', ')));
      if (viaPlace) { await until('teleported', async () => { const p = await pose(); return Math.hypot(p.x - MAP.x, p.z - (MAP.z + 2.3)) < 1.2 ? p : null; }, 5000); await sleep(900); }
      else { await key('Escape'); await sleep(500); }
      // back in the world after the menu: the click hint, a click catches the mouse again
      if (!(await lockState()).locked) { await click(W / 2, H / 2); await until('locked', async () => (await lockState()).locked, 3000); }
      if (!viaPlace) await walkTo(-6.1, -21.0);
    }
    // run 1 looks at the middle of the map (the Gulf of Guinea: the whole world opens), run 2 at Australia
    const aimAt = run === 2 ? onWall(134, -25) : { x: MAP.x, y: MAP.y - 0.15, z: MAP.z };
    await lookAt(aimAt.x, aimAt.y, aimAt.z);
    await sleep(400);
    const look = await ev(() => ({ ring: document.querySelector('#crosshair').classList.contains('active'), target: (() => { const t = window.__app.world.actions.target; return t ? { type: t.type, kind: t.kind || null, d: +(t.distance || 0).toFixed(2) } : null; })(), label: document.querySelector('#look-label, .look-label')?.textContent || '' }));
    ok(R(`Blick auf die Wandkarte aus ${look.target?.d ?? '?'} m: der Ring zeigt, dass sie sich benutzen lässt`), look.ring && look.target?.kind === 'worldmap', look);
    await snap(`wmr-${run}-vor-der-karte`);

    // ---- open it: a left click (run 1) or E (run 2) ---------------------------------------------------------------
    const t0 = Date.now();
    if (run % 2) { await page.mouse.down(); await sleep(70); await page.mouse.up(); }
    else await key('KeyE');
    const opened = await until('map panel', () => panelOpen(), 15000, 50);
    const drawn = await until('first tiles', () => wm((w) => w.stats().loaded > 0), 15000, 50);
    const openMs = Date.now() - t0;
    ok(R(`${run % 2 ? 'Linksklick' : 'E'} öffnet die Weltkarte`), !!opened && !!drawn, `${openMs} ms bis zu den ersten Kacheln`);
    if (!opened) { await snap(`wmr-${run}-nicht-geoeffnet`); continue; }
    await prepareMap();
    ok(R('Die Karte ist schnell da (unter 2,5 s)'), openMs < 2500, `${openMs} ms`);
    const ul = await until('pointer released', async () => { const s = await lockState(); return !s.el && !s.locked ? s : null; }, 2000, 50);
    ok(R('Die Maus ist frei, sobald die Karte offen ist'), !!ul, ul || await lockState());
    // Chromium puts the cursor back where it was caught
    const at = await ev(() => window.__pl.at);
    await mouseTo(at[0], at[1]);
    ok(R('Die 3D-Welt ruht hinter der Karte'), await ev(() => window.__app.world.background === 'paused' && !window.__app.world.player.enabled));
    if (run === 2) {
      const s = await until('card of the country looked at', () => sel(), 3000, 100);
      ok(R('Blick auf Australien an der Wandkarte, E: die Tafel öffnet mit dem Steckbrief von Australien'), s?.country === 'AUS' && !s.city, s);
      await snap(`wmr-${run}-australien`);
      if (s) { await key('Escape'); await sleep(250); }
      await key('Digit0'); await sleep(700);
    }
    const geo = await ev(() => { const b = document.querySelector('.wm-body').getBoundingClientRect(), c = document.querySelector('.wm-canvas').getBoundingClientRect(); return { body: [Math.round(b.width), Math.round(b.height)], canvas: [Math.round(c.width), Math.round(c.height)], dpr: devicePixelRatio }; });
    await settle();
    const geo2 = await ev(() => { const b = document.querySelector('.wm-body').getBoundingClientRect(), c = document.querySelector('.wm-canvas').getBoundingClientRect(); return { body: [Math.round(b.width), Math.round(b.height)], canvas: [Math.round(c.width), Math.round(c.height)] }; });
    ok(R('Die Karte füllt ihre Fläche (kein Rand nach dem Einblenden)'), Math.abs(geo2.body[0] - geo2.canvas[0]) <= 1 && Math.abs(geo2.body[1] - geo2.canvas[1]) <= 1, { atOpen: geo, after: geo2 });
    await snap(`wmr-${run}-offen`);
    const hint = await ev(() => { const h = document.querySelector('.wm-hint'); return h && !h.hidden && getComputedStyle(h).opacity > 0.3 ? h.textContent.trim() : ''; });
    if (run === 1) ok(R('Ein kurzer Hinweis sagt, was man anklicken kann'), /Land|Stadt/.test(hint), hint);

    try {
    // ---- hover and click a big country --------------------------------------------------------------------------------
    const de = await countryPoint('DEU');
    await mouseTo(de[0] - 40, de[1] - 30, 4); await mouseTo(de[0], de[1], 6); await sleep(250);
    const hov = { ...await hoverState(de[0], de[1]), outline: await ev(() => !!document.querySelector('.wm-osm path.wm-hover-shape')) };
    const tip = await tipText();
    ok(R('Über Deutschland: Name mit Hauptstadt und Einwohnern am Zeiger, Land hervorgehoben, Zeiger als Hand'), /Deutschland Hauptstadt Berlin · [\d,]+ Mio\. Einw\./.test(tip) && hov.hover === 'DEU' && hov.outline && hov.cursor === 'pointer', { tip, ...hov });
    await snap(`wmr-${run}-hover-deutschland`);
    await page.mouse.down(); await sleep(80); await page.mouse.up(); await sleep(450);
    let card = await cardText();
    ok(R('Klick auf Deutschland öffnet den Steckbrief'), (await sel())?.country === 'DEU' && /Hauptstadt Berlin/.test(card), card.slice(0, 120));
    const actionsInSight = await ev(() => {
      const card = document.querySelector('.wm-card'); if (!card || card.hidden) return null;
      const c = card.getBoundingClientRect();
      return ['Street View', 'Heranzoomen'].map((t) => { const b = [...card.querySelectorAll('button')].find((x) => x.textContent.includes(t)); if (!b) return t + ': fehlt'; const r = b.getBoundingClientRect(); return r.top >= c.top && r.bottom <= c.bottom ? true : `${t}: ${Math.round(r.top - c.bottom)} px unter dem sichtbaren Teil`; });
    });
    ok(R('Street View und Heranzoomen sind im Steckbrief ohne Scrollen zu sehen'), actionsInSight?.every((x) => x === true), actionsInSight);
    // a click with a small wobble of the hand still counts as a click
    const br = await countryPoint('BRA');
    await mouseTo(br[0], br[1], 5); await sleep(120);
    await page.mouse.down(); await page.mouse.move(br[0] + 3, br[1] + 2); await page.mouse.move(br[0] + 4, br[1] + 3); await sleep(60); await page.mouse.up(); cur.x = br[0] + 4; cur.y = br[1] + 3; await sleep(450);
    ok(R('Ein Klick mit leicht zitternder Hand (4 px) wählt Brasilien'), (await sel())?.country === 'BRA', await sel());

    // ---- drag, wheel, keys and buttons ------------------------------------------------------------------------------------
    if (await sel()) { await key('Escape'); await sleep(200); }
    const s0 = await mapState();
    const body = await rectOf('.wm-body');
    const sea = [body.x - body.w * 0.18, body.y + body.h * 0.12];
    await mouseTo(sea[0], sea[1], 4); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(sea[0] - i * 14, sea[1] + i * 6); await sleep(16); }
    await page.mouse.up(); cur.x = sea[0] - 280; cur.y = sea[1] + 120;
    await sleep(900); await settle();
    const s1 = await mapState();
    ok(R('Ziehen verschiebt die Karte (und wählt nichts)'), Math.hypot(s1.center[0] - s0.center[0], s1.center[1] - s0.center[1]) > 0.05 && !s1.sel, { from: s0.center, to: s1.center, sel: s1.sel });
    await key('Digit0'); await settle();

    // ---- the views of the atlas: a click on "Bevölkerung" colours the countries by density, the legend shows its classes,
    // the name tag over Germany its value; "Länder" back -------------------------------------------------------------------
    const viewOf = () => wm((w) => { let fill = null; w.view.fills.eachLayer((l) => { if (l.country?.id === 'DEU') fill = l._path?.getAttribute('fill'); }); return { mode: w.stats().mode, on: [...document.querySelectorAll('.wm-legend .wm-mode.on')].map((b) => b.textContent).join(), swatches: document.querySelectorAll('.wm-legend .wm-lg-swatch').length, fill }; });
    const v0 = await viewOf();
    const toDensity = await clickText('.wm-legend .wm-mode', /^Bevölkerung$/);
    await sleep(300);
    const v1 = await viewOf();
    const de3 = await countryPoint('DEU');
    if (de3) { await mouseTo(de3[0] - 30, de3[1] - 20, 4); await mouseTo(de3[0], de3[1], 5); await sleep(250); }
    const densTip = await tipText();
    await snap(`wmr-${run}-ansicht-bevoelkerung`);
    const toCountries = await clickText('.wm-legend .wm-mode', /^Länder$/);
    await sleep(300);
    const v2 = await viewOf();
    ok(R('Ansichten: ein Klick auf „Bevölkerung“ färbt die Länder nach der Dichte, Legende mit sechs Stufen, das Namensschild nennt den Wert; „Länder“ zurück'), toDensity && toCountries && v0.mode === 'countries' && v1.mode === 'density' && v1.on === 'Bevölkerung' && v1.swatches === 6 && v1.fill !== v0.fill && /Deutschland 232 Einw\.\/km²/.test(densTip) && v2.mode === 'countries' && v2.fill === v0.fill && v2.swatches === 0, { v0, v1, v2, tip: densTip });
    const eu = await countryPoint('FRA');
    await mouseTo(eu[0], eu[1], 6);
    const z0 = (await mapState()).zoom;
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await sleep(60); }
    await sleep(500); await settle();
    const z1 = (await mapState()).zoom;
    const still = await ev(([x, y]) => { const v = document.querySelector('.wm-panel').__wm.view, r = v.el.getBoundingClientRect(); const h = v.hitAt({ x: x - r.left, y: y - r.top }); return h?.country?.id || h?.city?.name || h?.type; }, [eu[0], eu[1]]);
    // Leaflet zooms 0.75 levels per notch of 100 px and lets the notches pass that come while its zoom animation runs
    // (250 ms): six quick notches make one level or a little more
    ok(R('Mausrad zoomt zum Zeiger hin'), z1 >= z0 + 0.75 && still === 'FRA', { z0, z1, underCursor: still });
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await sleep(60); }
    await sleep(500); await settle();
    const z2 = (await mapState()).zoom;
    ok(R('Mausrad zurück zoomt wieder heraus'), z2 <= z1 - 0.75, { z1, z2 });
    await key('Equal'); await settle(); const zk1 = (await mapState()).zoom;
    await key('Minus'); await settle(); const zk2 = (await mapState()).zoom;
    await clickSel('.wm-zoom .wm-zbtn:nth-child(1)'); await settle(); const zb1 = (await mapState()).zoom;
    await clickSel('.wm-zoom .wm-zbtn:nth-child(2)'); await settle(); const zb2 = (await mapState()).zoom;
    await clickSel('.wm-zoom .wm-zbtn:nth-child(3)'); await settle(); const zb3 = (await mapState()).zoom, world = await wholeWorld();
    // a level of zoom (Leaflet) per key and per button, ⌂ the whole world
    ok(R('Zoomen mit + und − (Tasten) und den Knöpfen + − ⌂'), zk1 > z2 + 0.9 && zk2 < zk1 - 0.9 && zb1 > zk2 + 0.9 && zb2 < zb1 - 0.9 && world, { z2, zk1, zk2, zb1, zb2, zb3, world });

    // ---- small countries and city dots ---------------------------------------------------------------------------------
    /** from the whole world, wheel in over a country until it is `px` pixels across (the wheel keeps the point under
     *  the cursor in place) */
    const zoomOnto = async (id, px) => {
      await key('Digit0'); await settle();
      let g = null;
      for (let i = 0; i < 40; i++) {
        g = await wm((w, id) => { const P = window.__wmProj, c = w.data.byId.get(id), r = w.view.el.getBoundingClientRect(); const a = P.toScreen(w, c.bbox[0], c.bbox[1]), b = P.toScreen(w, c.bbox[2], c.bbox[3]), l = P.toScreen(w, c.label[0], c.label[1]); return { size: +Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)).toFixed(1), at: [r.left + l.x, r.top + l.y], zoom: w.view.zoom }; }, id);
        if (g.size >= px) break;
        await mouseTo(g.at[0], g.at[1], 2);
        await page.mouse.wheel(0, -100); await sleep(70);
        await settle();
      }
      return g;
    };
    /** inside the country, 2 px clear of its border all round (a click lands on whole pixels), as far as possible from every city that answers (and
     *  of two such points the one nearer the middle): [page x, page y, distance to that city] */
    const innerPoint = (id) => wm((w, id) => {
      const P = window.__wmProj, c = w.data.byId.get(id), r = w.view.el.getBoundingClientRect(), b = c.bbox;
      const mid = P.toScreen(w, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      let best = null;
      for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
        const x = b[0] + (b[2] - b[0]) * i / 24, y = b[1] + (b[3] - b[1]) * j / 24;
        if (w.data.countryAt(x, y) !== c) continue;
        const s = P.toScreen(w, x, y);
        let inside = true;
        for (let k = 0; k < 8 && inside; k++) inside = P.countryUnder(w, s.x + 2 * Math.cos(k * Math.PI / 4), s.y + 2 * Math.sin(k * Math.PI / 4)) === c;
        if (!inside) continue;
        const dd = Math.min(30, P.cityDist(w, s.x, s.y)), dm = Math.hypot(s.x - mid.x, s.y - mid.y);
        if (!best || dd > best[2] + 0.5 || (Math.abs(dd - best[2]) <= 0.5 && dm < best[3])) best = [r.left + s.x, r.top + s.y, +dd.toFixed(1), dm];
      }
      return best && best.slice(0, 3);
    }, id);
    // a city answers 9 px around its point (osm-view.js), inside a country under 12 px and from a neighbouring
    // country only on its dot: a small country of some 24 px is selected away from its own cities
    const small = [];
    for (const [id, px] of [['LUX', 24], ['MLT', 24], ['SGP', 24], ['LIE', 24]]) {
      const z = await zoomOnto(id, px);
      const pt = await innerPoint(id);
      if (!pt) { small.push({ id, size: z?.size, err: 'kein Punkt' }); continue; }
      await mouseTo(pt[0], pt[1], 5); await sleep(220);
      const t = await tipText();
      await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(450);
      const s = await sel();
      small.push({ id, size: z?.size, dotDist: pt[2], tip: t, sel: s?.city || s?.country || null });
      if (s) { await key('Escape'); await sleep(150); }
    }
    ok(R('Kleine Länder (gut 24 Pixel) lassen sich abseits ihrer Städte anklicken: Luxemburg, Malta, Singapur, Liechtenstein'), small.every((x) => x.sel === x.id), small);
    // Singapore and Johor Bahru (Malaysia) across the strait: the city's dot opens the city, a few pixels from it
    // inside Singapore it is Singapore
    await zoomOnto('SGP', 24);
    const jb = await wm((w) => {
      const P = window.__wmProj, m = w.view.map, r = w.view.el.getBoundingClientRect(), sgp = w.data.byId.get('SGP');
      const p = w.data.places.find((x) => x.name === 'Johor Bahru'); if (!p) return null;
      const q = m.latLngToContainerPoint([p.lat, p.lon]);
      // the nearest city of Singapore itself must be out of reach there (9 px)
      const own = (x, y) => Math.min(99, ...w.data.places.filter((c) => c.country === sgp.index && c.minZoom <= m.getZoom() + 0.5).map((c) => { const s = m.latLngToContainerPoint([c.lat, c.lon]); return Math.hypot(s.x - x, s.y - y); }));
      // whole page pixels (the mouse lands on them), Singapore all round it, 4 to 8 px from the dot
      let near = null;
      for (let d = 4; d <= 8 && !near; d++) for (let k = 0; k < 24 && !near; k++) {
        const px = Math.round(r.left + q.x + d * Math.cos(k * Math.PI / 12)), py = Math.round(r.top + q.y + d * Math.sin(k * Math.PI / 12));
        const x = px - r.left, y = py - r.top, dd = Math.hypot(x - q.x, y - q.y);
        if (dd < 4 || dd > 8.5 || own(x, y) <= 10) continue;
        let inside = true;
        for (const [ox, oy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) inside = inside && P.countryUnder(w, x + ox, y + oy) === sgp;
        if (inside) near = [px, py, +dd.toFixed(1)];
      }
      return { dot: [r.left + q.x, r.top + q.y], near, zoom: w.view.zoom };
    });
    const jbSel = [];
    for (const at of [jb?.dot, jb?.near]) {
      if (!at) { jbSel.push(null); continue; }
      await mouseTo(at[0], at[1], 4); await sleep(200);
      await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(450);
      const s = await sel(); jbSel.push(s?.city || s?.country || null);
      if (s) { await key('Escape'); await sleep(150); }
    }
    ok(R('Johor Bahru: sein Punkt öffnet die Stadt, wenige Pixel daneben in Singapur öffnet sich Singapur'), jbSel[0] === 'Johor Bahru' && jbSel[1] === 'SGP', { ...jb, sel: jbSel });
    // a click a few pixels off the coast of an island state still selects it
    await zoomOnto('MLT', 12);
    // west of Gozo and Malta, away from Valletta's dot: 5 px out on the sea
    const offshore = await wm((w) => { const P = window.__wmProj, c = w.data.byId.get('MLT'), r = w.view.el.getBoundingClientRect(); let best = null; for (const ring of c.rings) for (let i = 0; i < ring.length; i += 2) if (!best || ring[i] < best[0]) best = [ring[i], ring[i + 1]]; const s = P.toScreen(w, best[0], best[1]); return [r.left + s.x - 5, r.top + s.y]; });
    await mouseTo(offshore[0], offshore[1], 4); await sleep(220);
    const offTip = await tipText();
    await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(450);
    const offSel = await sel();
    ok(R('Ein Klick 5 px neben die Küste eines Inselstaats wählt ihn (Malta)'), offSel?.country === 'MLT' && !offSel.city, { tip: offTip, sel: offSel });
    if (offSel) { await key('Escape'); await sleep(150); }

    // a city dot: Germany's card, "Zoom in", then Hamburg
    await key('Digit0'); await settle();
    const de2 = await countryPoint('DEU');
    await click(de2[0], de2[1]); await sleep(300);
    const zoomed = await clickInCard(/Heranzoomen|Zoom in/); await sleep(900); await settle();
    if (!zoomed) info(R('Heranzoomen'), 'Knopf nicht gefunden');
    const hh = await cityPoint('Hamburg');
    if (hh) { await mouseTo(hh[0] + 6, hh[1] - 5, 4); await mouseTo(hh[0] + 2, hh[1] + 2, 3); await sleep(250); }
    const hhTip = await tipText();
    const hhCursor = hh ? (await hoverState(hh[0] + 2, hh[1] + 2)).cursor : null;
    if (hh) { await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(500); }
    card = await cardText();
    ok(R('Stadtpunkt: Name am Zeiger, Hand, Klick (2 px daneben) öffnet Hamburg'), (await sel())?.city === 'Hamburg' && /Hamburg/.test(hhTip) && hhCursor === 'pointer' && /Einwohner/.test(card) && /Ortszeit/.test(card), { tip: hhTip, cursor: hhCursor, card: card.slice(0, 120) });
    await snap(`wmr-${run}-hamburg`);
    const cr = { facts: await contrast('.wm-card .wm-facts dd'), labels: await contrast('.wm-card .wm-facts dt'), head: await contrast('.wm-card h2') };
    ok(R('Steckbrief gut lesbar (Kontrast Text 4,5:1 und mehr)'), cr.facts >= 4.5 && cr.labels >= 4.5 && cr.head >= 4.5, cr);

    // ---- Wikipedia and Street View ----------------------------------------------------------------------------------------
    if (NET && run === 1) {
      const wiki = await until('Wikipedia', () => ev(() => document.querySelector('.wm-card .wm-wiki-text')?.textContent || ''), 25000, 400);
      ok(R('Wikipedia-Text im Steckbrief'), /Hamburg/.test(wiki || ''), (wiki || '').slice(0, 90));
      ok(R('Wikipedia-Text gut lesbar'), (await contrast('.wm-card .wm-wiki-text')) >= 7, await contrast('.wm-card .wm-wiki-text'));
      await clickInCard(/Street View/);
      const svOpen = await until('street view', () => wm((w) => { const s = w.sv.state(); return s.open && s.wcId != null && s.url ? s : null; }), 30000, 300);
      ok(R('Street View öffnet sich per Klick'), !!svOpen, svOpen?.url?.slice(0, 100) || '');
      if (svOpen) {
        // Google's consent page: "Alle ablehnen" with a real click into the page
        let s = svOpen;
        if (/consent\./.test(s.url)) {
          const b = await until('consent buttons', async () => {
            const r = await app.evaluate(({ webContents }, id) => webContents.fromId(id).executeJavaScript(`(() => { const b = [...document.querySelectorAll('button, input[type=submit]')].find((x) => /alle ablehnen|reject all/i.test(x.innerText || x.value || '')); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: (b.innerText || b.value).trim() }; })()`), s.wcId).catch(() => null);
            return r;
          }, 15000, 500);
          const vr = await rectOf('.wm-sv-view');
          if (b && vr) { await click(vr.x - vr.w / 2 + b.x, vr.y - vr.h / 2 + b.y); info(R('Einwilligung'), `abgelehnt mit einem Klick auf „${b.t}“`); }
          s = await until('maps after consent', () => wm((w) => { const x = w.sv.state(); return /google\.[a-z.]+\/maps/.test(x.url) ? x : null; }), 30000, 500) || s;
        }
        s = await until('panorama', () => wm((w) => { const x = w.sv.state(); return x.pano !== 'wait' ? x : null; }), 40000, 500);
        ok(R('Street View zeigt ein Panorama (oder die Karte der Umgebung)'), s && (s.pano === 'found' || s.fellBack), s ? `${s.pano} ${s.url.slice(0, 80)}` : '');
        await sleep(2500);
        await snap(`wmr-${run}-streetview`);
        // the map/satellite switch, then back and forward in the view's own history
        await clickText('.wm-sv-mode', /Satellit/); await sleep(3500);
        const before = (await wm((w) => w.sv.state())).url;
        const canBack = await ev(() => !document.querySelector('.wm-sv-bar .wm-sv-btn.icon').disabled);
        await clickSel('.wm-sv-bar .wm-sv-btn.icon'); await sleep(2500);
        const afterBack = (await wm((w) => w.sv.state())).url;
        info(R('Street View zurück'), { canBack, before: before.slice(0, 70), after: afterBack.slice(0, 70) });
        // Esc: the page has the focus; the key reaches it as a real key press
        await mouseTo(vr0(await rectOf('.wm-sv-view')).x, vr0(await rectOf('.wm-sv-view')).y);
        await key('Escape'); await sleep(900);
        let svs = await wm((w) => w.sv.state());
        if (svs.open) { info(R('Esc'), 'Esc erreichte die Seite nicht über die Tastatur des Fensters; zweiter Versuch über die Seite selbst'); await app.evaluate(({ webContents }, id) => { const wc = webContents.fromId(id); wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); }, svs.wcId).catch(() => {}); await sleep(900); svs = await wm((w) => w.sv.state()); }
        ok(R('Esc in Street View führt zur Karte zurück, der Steckbrief bleibt'), !svs.open && (await sel())?.city === 'Hamburg', svs);
      }
    }

    // ---- search ------------------------------------------------------------------------------------------------------------
    await mouseTo(W / 2, H / 2);
    await key('Slash'); await sleep(200);
    const focused = await ev(() => document.activeElement?.classList.contains('wm-search'));
    if (!focused) await clickSel('.wm-search');
    await page.keyboard.type('Lima', { delay: 70 });
    await sleep(350);
    const hits = await ev(() => [...document.querySelectorAll('.wm-res .wm-res-name')].map((x) => x.textContent));
    await key('Enter'); await sleep(900); await settle();
    ok(R('Suche mit der Tastatur: „Lima“, Enter öffnet die Stadt'), hits[0] === 'Lima' && (await sel())?.city === 'Lima', { hits: hits.slice(0, 3), sel: await sel() });

    // ---- back and forward: buttons, Alt+arrows, the mouse's side buttons, Windows app commands ----------------------------
    await mouseTo(W / 2, H / 2);
    const trail = [];
    const now = async () => { const s = await sel(); return s?.city || s?.country || null; };
    trail.push(await now());
    const backBtn = await rectOf('.wm-nav-back'), fwdBtn = await rectOf('.wm-nav-fwd');
    if (backBtn) { await click(backBtn.x, backBtn.y); await sleep(600); }
    trail.push(await now());
    if (fwdBtn) { await click(fwdBtn.x, fwdBtn.y); await sleep(600); }
    trail.push(await now());
    await mouseTo(W / 2, H / 2 + 40);
    await combo('Alt', 'ArrowLeft'); await sleep(500); trail.push(await now());
    await combo('Alt', 'ArrowRight'); await sleep(500); trail.push(await now());
    await sideButton('back'); await sleep(500); trail.push(await now());
    await sideButton('forward'); await sleep(500); trail.push(await now());
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); w.emit('app-command', {}, 'browser-backward'); });
    await sleep(600); trail.push(await now());
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); w.emit('app-command', {}, 'browser-forward'); });
    await sleep(600); trail.push(await now());
    const prevName = trail[1];
    ok(R('Zurück und Vor: Knöpfe, Alt+←/→, Maustasten 4 und 5, App-Befehle von Windows'), !!backBtn && !!fwdBtn && prevName && prevName !== 'Lima' && trail[0] === 'Lima' && trail[2] === 'Lima' && trail[3] === prevName && trail[4] === 'Lima' && trail[5] === prevName && trail[6] === 'Lima' && trail[7] === prevName && trail[8] === 'Lima', trail);
    await snap(`wmr-${run}-lima`);
    } catch (e) {
      ok(R('Der Ablauf in der Karte lief durch'), false, String(e?.stack || e).split(/\r?\n/).slice(0, 2).join(' '));
      if (!(await panelOpen())) { info(R('Karte'), 'ist nicht mehr offen'); }
    }

    // ---- Esc: the card, then the map; back in the world --------------------------------------------------------------------
    await key('Escape'); await sleep(300);
    const afterCard = { sel: await sel(), open: await panelOpen() };
    await key('Escape'); await sleep(900);
    const back = await ev(() => ({ open: !!document.querySelector('.panel-layer.open'), bg: window.__app.world.background, enabled: window.__app.world.player.enabled, hint: document.querySelector('#pointer-hint')?.classList.contains('show') }));
    ok(R('Esc schließt erst den Steckbrief, dann die Karte'), !afterCard.sel && afterCard.open && !back.open, { afterCard, back });
    ok(R('Zurück in der Welt: sie läuft wieder, Hinweis zum Klicken'), back.bg == null && back.enabled && back.hint, back);
    await click(W / 2, H / 2);
    const relock = await until('locked again', async () => { const s = await lockState(); return s.locked ? s : null; }, 3000);
    const notReopened = !(await panelOpen());
    ok(R('Ein Klick fängt die Maus wieder (und öffnet die Karte nicht gleich wieder)'), !!relock && notReopened, { relock, notReopened });
    await snap(`wmr-${run}-zurueck`);
    // look away from the map for the next run
    await turn(1.3, -0.2);
  }

  await sleep(500);
  ok('Alle Kacheln kamen aus der Prüfung (keine Anfrage an OpenStreetMap am Weg vorbei), jede mit einer gültigen Adresse', tiles.served > 0 && !tiles.unrouted().length && !tiles.bad.length, { served: tiles.served, unrouted: tiles.unrouted().slice(0, 3), bad: tiles.bad.slice(0, 3) });
  ok('Keine Fehler im Renderer (auch keine fehlgeschlagene Kachel)', errors.length === 0, errors.slice(0, 6).join(' | '));
  ok('Keine Fehler im Hauptprozess', mainErrors.length === 0, mainErrors.slice(0, 6).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY ${results.length - failed.length}/${results.length} passed${failed.length ? '; failed: ' + failed.map((f) => f.name).join('; ') : ''}`);

  function vr0(r) { return r || { x: W / 2, y: H / 2 }; }
};
