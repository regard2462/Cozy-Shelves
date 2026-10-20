// Check of 0.7 inside the house: floor designs, graffiti in the language of the interface, lamps switched one by one,
// the smaller book card, the e-reader's lectern at the height of the encyclopedia's. Run twice with the same
// COZYSHELVES_USERDATA (a fresh one for the first run):
//   node build/screenshot.js interior2-check                        every part, ends with terrazzo, one lamp off, German
//   IX2_PHASE=restart node build/screenshot.js interior2-check      after a restart: the floor and the lamp are kept
// IX2_PARTS=floors,graffiti,lectern,lamps,card,shots picks parts (shots: every floor in the hall and the book room).
// Frame times need a quiet machine: they start once the library is indexed, wait for the graphics card (nvidia-smi under
// 60 % and 13 GB) and the processors (under 70 %), and a measurement counts only when its control just before it had no
// frame over 50 ms and no long task (for the floors the same settings change without a new floor, for the mural a window
// without anything) and no shelves were drawn again meanwhile. When other programs keep the machine busy all the time,
// a frame time check is skipped (SKIP, with the reason), never passed.
// Needs a library with books with real covers (COZYSHELVES_BOOKS="<copy of testbooks4>|structured"). Muted and hidden as
// every harness script.
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/** The graphics card's load (several programs may share it): { mem MiB, util % } or null without nvidia-smi. */
function gpuLoad() {
  try { const [mem, util] = execSync('nvidia-smi --query-gpu=memory.used,utilization.gpu --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0].split(',').map((x) => +x.trim()); return { mem, util }; } catch { return null; }
}

/** How busy the processors were over the next `ms` (0 to 1, all cores together). */
async function cpuLoad(sleep, ms = 1000) {
  const a = os.cpus(); await sleep(ms); const b = os.cpus();
  let idle = 0, total = 0;
  b.forEach((c, i) => { const p = a[i].times, q = c.times; idle += q.idle - p.idle; total += (q.user - p.user) + (q.nice - p.nice) + (q.sys - p.sys) + (q.idle - p.idle) + (q.irq - p.irq); });
  return total ? 1 - idle / total : 0;
}

module.exports = async ({ app, page, shot, sleep }) => {
  /** Frame times mean little on a machine busy with other programs: wait (up to `ms`) until the graphics card and the
   *  processors are quieter. Returns the load: { mem, util, cpu %, quiet }. */
  const waitQuiet = async (ms = 180000) => {
    const t0 = Date.now();
    for (;;) {
      const g = gpuLoad(), cpu = Math.round(await cpuLoad(sleep) * 100);
      const quiet = (!g || (g.util <= 60 && g.mem <= 13000)) && cpu <= 70;
      if (quiet || Date.now() - t0 > ms) return { ...(g || {}), cpu, quiet };
      await sleep(4000);
    }
  };
  const restart = process.env.IX2_PHASE === 'restart';
  const parts = new Set((process.env.IX2_PARTS || 'floors,graffiti,lectern,lamps,card,shots').split(','));
  let passes = 0, fails = 0, skips = 0;
  const check = (name, ok, info) => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); return !!ok; };
  /** A frame time check that could not be measured on a quiet machine: neither passed nor failed. */
  const skip = (name, info) => { skips++; console.log(`SKIP ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`); };
  const note = (name, info) => console.log(`INFO ${name} ${typeof info === 'string' ? info : JSON.stringify(info)}`);
  const errors = [];
  const ignore = [/pointer lock/i, /THREE\.Clock/, /net::ERR_|Failed to load resource/];
  page.on('pageerror', (e) => { if (!ignore.some((r) => r.test(e.message))) errors.push('pageerror: ' + e.message.slice(0, 300)); });
  page.on('console', (m) => { if ((m.type() === 'error' || /Shader Error|WebGLProgram/.test(m.text())) && !ignore.some((r) => r.test(m.text()))) errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  /** The window's inner size exactly, left of every display (as worldmap-real-check). */
  const setViewport = async (W, H) => {
    await app.evaluate(async ({ BrowserWindow, screen }, a) => {
      const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL()));
      const minX = Math.min(0, ...screen.getAllDisplays().map((d) => d.bounds.x));
      w.setMinimumSize(800, 600);
      w.setContentBounds({ x: minX - a.W - 600, y: 0, width: a.W, height: a.H });
      await new Promise((r) => setTimeout(r, 300));
      const got = w.getContentBounds();
      if (got.width !== a.W || got.height !== a.H) { const b = w.getBounds(); w.setBounds({ x: minX - a.W - 600, y: 0, width: b.width - (got.width - a.W), height: b.height - (got.height - a.H) }); await new Promise((r) => setTimeout(r, 300)); }
    }, { W, H });
    for (let i = 0; i < 30; i++) { const v = await ev(() => [innerWidth, innerHeight]); if (Math.abs(v[0] - W) <= 1 && Math.abs(v[1] - H) <= 1) return v; await sleep(100); }
    return ev(() => [innerWidth, innerHeight]);
  };
  await setViewport(1600, 900);

  // ---- boot --------------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  const stored = await ev(async () => { const s = await window.api.settings.get(); return { floor: s.floor, lampsOff: s.lampsOff, walls: s.walls, language: s.language }; });
  await ev(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 90; i++) {
    const st = await ev(() => { const b = window.__app.state.library.books; return { n: b.length, active: !!window.__app.state.library.scan?.active }; });
    if (st.n > 0 && !st.active) break;
    await sleep(2000);
  }
  // a fresh library is indexed in the background (covers, metadata, shelves drawn again): frame times say nothing
  // before it is done. Every book indexed (five minutes at most), then no build for 5 s
  const indexing = { t0: Date.now() };
  for (;;) {
    const st = await ev(() => { const b = window.__app.state.library.books; return { n: b.length, open: b.filter((x) => x.indexed === false).length, active: !!window.__app.state.library.scan?.active }; });
    Object.assign(indexing, st);
    if ((st.n > 0 && st.open === 0 && !st.active) || Date.now() - indexing.t0 > 300000) break;
    await sleep(2000);
  }
  note('library indexed', { books: indexing.n, notIndexed: indexing.open, waited: Date.now() - indexing.t0 });
  for (let i = 0, last = -1, since = Date.now(); i < 60; i++) {
    const n = await ev(() => window.__app.world.buildTimes.length + ':' + window.__app.state.library.books.filter((b) => b.indexed !== false).length);
    if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since > 5000) break;
    await sleep(1000);
  }
  await ev(() => {
    const w = window.__app.world, p = w.player;
    window.__ix2 = {
      pose(x, z, yaw, pitch) { if (w.actions.seatedId || p.seated) w.actions.leaveSeat(); p.transition = null; p.setPose(x, z, yaw, pitch); },
      look() { p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); const t = w.actions.target; return t ? { type: t.type, lamp: t.lamp || null, kind: t.lampKind || t.kind || null, on: t.on ?? null, book: t.book?.id || null } : null; },
      label() { const el = document.querySelector('#look-label'), keys = el.querySelector('.ll-keys'); return { show: el.classList.contains('show') && getComputedStyle(el).visibility !== 'hidden', name: el.querySelector('.ll-name').textContent, key: keys.hidden ? '' : keys.querySelector('kbd').textContent + ' ' + keys.querySelector('.ll-what').textContent }; },
      points() { let n = 0; w.scene.traverse((o) => { if (o.isPointLight) n++; }); return n; },
      /** stand in front of a lamp and look at it: the first free spot round it from which the look ray meets it */
      aimLamp(id) {
        const e = w.lampSwitch.byId.get(id); if (!e) return null;
        const b = e.obj.userData.pickBox, cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
        const rot = e.obj.rotation.y, fx = Math.sin(rot), fz = Math.cos(rot);
        const tries = [];
        if (e.kind === 'sconce') for (const d of [1.4, 1.1, 1.8, 2.2]) for (const s of [0, 0.5, -0.5]) tries.push([cx + fx * d + fz * s, cz + fz * d - fx * s]);
        for (const d of [1.2, 1.5, 0.9, 1.9, 2.4]) for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; tries.push([cx + Math.cos(a) * d, cz + Math.sin(a) * d]); }
        for (const [x, z] of tries) {
          if (!p.isFree(x, z, 0.06)) continue;
          const yaw = Math.atan2(-(cx - x), -(cz - z)), pitch = Math.atan2(cy - 1.62, Math.hypot(cx - x, cz - z));
          this.pose(x, z, yaw, pitch);
          const t = this.look();
          if (t?.type === 'lamp' && t.lamp === id) return { x: +x.toFixed(2), z: +z.toFixed(2), t };
        }
        return null;
      },
      /** Frame times for `ms`, the long tasks of the main thread meanwhile (over 50 ms each: script, not the graphics
       *  card, which other programs may keep busy), and what the world's own work took of them: its longest frame(),
       *  every applySettings (a settings change runs it, the floor's among them) and every updateLibrary (the shelves
       *  drawn again for books indexed in the background) */
      frames(ms) {
        if (!this.obs) { this.long = []; this.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) this.long.push(Math.round(e.duration)); }); this.obs.observe({ entryTypes: ['longtask'] }); }
        if (!this.own) {
          const own = this.own = { frame: 0, apply: [], lib: [] }, frame0 = w.frame, apply0 = w.applySettings, lib0 = w.updateLibrary;
          w.frame = function () { const t = performance.now(), r = frame0.call(this), d = performance.now() - t; if (d > own.frame) own.frame = d; return r; };
          w.applySettings = function (s) { const t = performance.now(), r = apply0.call(this, s); own.apply.push(Math.round(performance.now() - t)); return r; };
          w.updateLibrary = function (l) { const t = performance.now(), r = lib0.call(this, l); own.lib.push(Math.round(performance.now() - t)); return r; };
        }
        this.long.length = 0; this.own.frame = 0; this.own.apply.length = 0; this.own.lib.length = 0;
        return new Promise((resolve) => {
          const t = []; let last = 0; const t0 = performance.now();
          const tick = (now) => { if (last) t.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(tick); else { const s = [...t].sort((a, b) => a - b); resolve({ n: t.length, max: +(s[s.length - 1] || 0).toFixed(1), p95: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(1), over50: t.filter((x) => x > 50).length, long: this.long.slice(), frameMs: +this.own.frame.toFixed(1), applyMs: this.own.apply.slice(), libMs: this.own.lib.slice() }); } };
          requestAnimationFrame(tick);
        });
      },
      programs() { return w.renderer.info.programs.map((q) => q.cacheKey); },
    };
  });
  const lampIds = await ev(() => window.__app.world.lampSwitch.info().lamps.map((l) => ({ id: l.id, kind: l.kind })));
  note('lamps', { count: lampIds.length, kinds: [...new Set(lampIds.map((l) => l.kind))] });
  const hallFloorLamp = lampIds.find((l) => l.kind === 'floorlamp')?.id;

  // ======================================================== after a restart =====================================================
  if (restart) {
    check('restart: the floor is stored', stored.floor === 'terrazzo', stored);
    let fi = null;
    for (let i = 0; i < 100; i++) { fi = await ev(() => window.__app.world.floors.info()); if (fi.shown === 'terrazzo') break; await sleep(100); }
    check('restart: the stored floor is on the floors again', fi.shown === 'terrazzo', fi);
    const li = await ev((id) => window.__app.world.lampSwitch.info().lamps.find((l) => l.id === id), hallFloorLamp);
    check('restart: the lamp switched off stays off (light, decals, shade)', stored.lampsOff?.includes(hallFloorLamp) && li && !li.on && li.texel === 0 && li.lights.every((x) => x === 0) && li.glows.every((x) => x === 0), { stored: stored.lampsOff, lamp: li });
    const others = await ev((id) => window.__app.world.lampSwitch.info().lamps.filter((l) => l.id !== id && (!l.on || l.texel !== 255)).length, hallFloorLamp);
    check('restart: every other lamp is on', others === 0, others);
    await ev(() => { window.__ix2.pose(-6, 2.6, Math.PI * 0.6, -0.35); window.__app.world.frame(); });
    await sleep(400);
    await shot('ix2-restart-hall');
    check('restart: no errors', errors.length === 0, errors.slice(0, 5));
    console.log(`SUMMARY interior2-check restart: ${passes} passed, ${fails} failed${skips ? `, ${skips} skipped` : ''}`);
    return;
  }

  // ======================================================== 1. floors ===========================================================
  const STYLES = ['oak', 'herringbone', 'walnut', 'maple', 'marble', 'terracotta', 'stone', 'terrazzo', 'carpet', 'cement'];
  if (parts.has('floors')) {
    check('floors: oak boards by default', (stored.floor ?? 'oak') === 'oak' && (await ev(() => window.__app.world.floors.info().shown)) === 'oak', stored.floor);
    // the settings panel: the choices right after the walls, each with a picture, reachable by keyboard
    await ev(() => window.__app.openPanel('settings', { section: 'general' }));
    await page.waitForSelector('.floor-opt', { timeout: 10000 });
    const panel = await ev(() => {
      const rows = [...document.querySelectorAll('.settings-content > .setting')];
      const iw = rows.findIndex((r) => r.classList.contains('setting-walls')), iF = rows.findIndex((r) => r.classList.contains('setting-floors'));
      return { iw, iF, label: rows[iF]?.querySelector('label')?.firstChild?.textContent, opts: [...document.querySelectorAll('.floor-opt')].map((b) => [b.dataset.floor, b.textContent.trim(), b.tagName]) };
    });
    check('floors: "Fußboden" right after the wall design, ten choices', panel.iF === panel.iw + 1 && panel.label === 'Fußboden' && panel.opts.map((o) => o[0]).join(',') === STYLES.join(','), panel);
    check('floors: every choice is a button with its name (Eichendielen … Bunte Zementfliesen)', panel.opts.every((o) => o[2] === 'BUTTON' && o[1].length > 3) && panel.opts[0][1] === 'Eichendielen' && panel.opts[4][1] === 'Schachbrett aus Marmor', panel.opts.map((o) => o[1]));
    let painted = [];
    for (let i = 0; i < 40; i++) {
      painted = await ev(() => [...document.querySelectorAll('.floor-swatch')].map((c) => { const r = document.createElement('canvas'); r.width = c.width; r.height = c.height; const x = r.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let lo = 255, hi = 0; for (let k = 0; k < d.length; k += 4 * 37) { const v = d[k] + d[k + 1] + d[k + 2]; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; }));
      if (painted.every((v) => v > 20)) break;
      await sleep(500);
    }
    check('floors: every choice shows a small picture of its floor', painted.every((v) => v > 20), painted);
    await shot('ix2-settings-floors');
    // a choice by keyboard: Tab to the button, Enter
    await page.focus('.floor-opt[data-floor="maple"]');
    await page.keyboard.press('Enter');
    let viaKey = null;
    for (let i = 0; i < 80; i++) { viaKey = await ev(() => ({ s: window.__app.state.settings.floor, info: window.__app.world.floors.info(), on: document.querySelector('.floor-opt.on')?.dataset.floor })); if (viaKey.info.shown === 'maple') break; await sleep(100); }
    check('floors: chosen with the keyboard (Enter on the button), the floor follows', viaKey.s === 'maple' && viaKey.info.shown === 'maple' && viaKey.on === 'maple', viaKey);
    await ev(() => window.__app.closeAllPanels());
    await sleep(800);

    // every style through the settings, the world running: frames, programs, errors
    note('floors: the machine before the frame times', await waitQuiet());
    const base = await ev(() => window.__ix2.frames(1500));
    note('floors baseline frames', base);
    const progs0 = await ev(() => window.__ix2.programs());
    const floorProgs0 = progs0.filter((k) => /floor-1/.test(k)).length;
    const results = [];
    const order = ['marble', 'walnut', 'herringbone', 'terracotta', 'stone', 'terrazzo', 'carpet', 'cement', 'oak', 'maple', 'marble', 'oak'];
    // A switch, and right before it the same settings change without a new floor (the floor it already has): the
    // control shows what the machine and the settings path (main.js onSettingsChanged, World.applySettings) cost at this
    // moment. The switch counts when its control had no frame over 50 ms and no long task, and no shelves were drawn
    // again in either window.
    const switchTo = async (st, patience = 45000) => {
      const load = await waitQuiet(patience);
      const before = await ev(() => window.__app.world.floors.info());
      const control = ev(() => window.__ix2.frames(3000));
      await ev((x) => window.api.settings.set({ floor: x }), before.shown);
      const ctl = await control;
      const t0 = Date.now();
      const measure = ev(() => window.__ix2.frames(4500));
      await ev((st) => window.api.settings.set({ floor: st }), st);
      let fi = null;
      while (Date.now() - t0 < 20000) { fi = await ev(() => window.__app.world.floors.info()); if (fi.shown === st && !fi.painting) break; await sleep(50); }
      const fr = await measure;
      // (a floor still on the card from the switch before shows at once: no painting, no steps)
      const painted = fi.paints > before.paints;
      return { st, ok: fi.shown === st, painted, counts: ctl.over50 === 0 && ctl.long.length === 0 && !ctl.libMs.length && !fr.libMs.length, control: { max: ctl.max, over50: ctl.over50, long: ctl.long, applyMs: ctl.applyMs, libMs: ctl.libMs }, load: [load.util, load.cpu], after: Date.now() - t0, paintMs: painted ? fi.paintMs : 0, steps: painted ? fi.uploadSteps : 0, stepMax: painted ? fi.uploadMaxMs : 0, max: fr.max, p95: fr.p95, over50: fr.over50, long: fr.long, frameMs: fr.frameMs, applyMs: fr.applyMs, libMs: fr.libMs };
    };
    for (const st of order) results.push(await switchTo(st));
    note('floors switches', results);
    check('floors: every style comes onto the floors (painted in the worker, shown when ready)', results.every((r) => r.ok), results.filter((r) => !r.ok));
    // the first painting of a session may cost more; after it no frame over 50 ms. A switch without a clean counted
    // measurement is measured again, three times at most and twelve times in all (two other painted floors first: the
    // card keeps the floor shown and the one before, so the style is painted anew); one clean counted measurement of a
    // switch is enough, a counted one with a frame over 50 ms stays when no clean one follows
    const showFloor = async (st) => {
      await ev((x) => window.api.settings.set({ floor: x }), st);
      for (let i = 0; i < 400; i++) { const fi = await ev(() => window.__app.world.floors.info()); if (fi.shown === st && !fi.painting) return; await sleep(50); }
    };
    const clean = (r) => r.counts && r.over50 === 0 && r.stepMax < 8;
    let retries = 12;
    for (const [i, r0] of results.entries()) {
      let r = r0;
      for (let k = 0; i > 0 && k < 3 && retries > 0 && !clean(r); k++, retries--) {
        for (const o of ['herringbone', 'terrazzo', 'carpet'].filter((x) => x !== r.st).slice(0, 2)) await showFloor(o);
        await sleep(1000);
        const again = await switchTo(r.st, 60000);
        note(`floors again ${r.st}`, again);
        if (again.counts || !r.counts) r = { ...again, tries: k + 2 };
      }
      results[i] = r;
    }
    const later = results.slice(1), counted = later.filter((r) => r.counts);
    // [style, counts or busy, control: longest frame, frames over 50; switch: longest frame, frames over 50, longest step]
    const table = later.map((r) => [r.st, r.counts ? 'counts' : 'busy', r.control.max, r.control.over50, r.max, r.over50, r.stepMax]);
    if (counted.length >= 6) {
      check(`floors: a step onto the graphics card (storage or a strip) costs the main thread under 8 ms, ${counted.length} of ${later.length} switches counted (a whole texture in one piece cost 20 to 100 ms)`, counted.every((r) => r.stepMax < 8), table);
      check(`floors: no frame over 50 ms while switching (after the first switch), ${counted.length} of ${later.length} switches counted (the same settings change without a new floor, just before, had none)`, counted.every((r) => r.over50 === 0), table);
    } else {
      skip('floors: step cost and frames over 50 ms while switching', `the machine was busy with other programs: the same settings change without a new floor had frames over 50 ms or long tasks before ${later.length - counted.length} of ${later.length} switches ${JSON.stringify(table)}`);
    }
    const progs1 = await ev(() => window.__ix2.programs());
    const newFloor = progs1.filter((k) => !progs0.includes(k) && /floor-1/.test(k));
    check('floors: no new shader program for any style (one floor program)', newFloor.length === 0 && floorProgs0 >= 1, { floorPrograms: floorProgs0, newFloorPrograms: newFloor.length, newOther: progs1.filter((k) => !progs0.includes(k)).map((k) => k.slice(0, 40)) });
    const mem = await ev(() => window.__app.world.floors.info());
    check('floors: at most two painted floors stay on the graphics card', mem.cached.length <= 3 && mem.mb < 110, mem);
    check('floors: no renderer errors', errors.length === 0, errors.slice(0, 5));
  }

  // every floor in the hall and in the book room (the world stands still for the pictures)
  if (parts.has('shots')) {
    await ev(() => { window.__app.world.stop(); document.querySelector('#hud').style.opacity = '0'; });
    const VIEWS = [['hall', -1.2, 3.4, 0.35, -0.36], ['room', -8.4, -10.3, -0.55, -0.42]];
    for (const st of STYLES) {
      await ev((st) => window.api.settings.set({ floor: st }), st);
      for (let i = 0; i < 300; i++) { const fi = await ev(() => { const w = window.__app.world; w.frame(); return w.floors.info(); }); if (fi.shown === st && !fi.painting) break; await sleep(25); }
      for (const [name, x, z, yaw, pitch] of VIEWS) {
        await ev(([x, z, yaw, pitch]) => { window.__ix2.pose(x, z, yaw, pitch); for (let i = 0; i < 6; i++) window.__app.world.frame(); }, [x, z, yaw, pitch]);
        await shot(`ix2-floor-${st}-${name}`);
      }
    }
    await ev(() => { document.querySelector('#hud').style.opacity = '1'; window.__app.world.start(); });
  }

  // ======================================================== 2. graffiti =========================================================
  if (parts.has('graffiti')) {
    // every word of every variant in both languages (the planner in the worker, as the walls use it)
    const plans = await ev(async () => {
      const walls = window.__app.world.walls.painterWalls();
      const worker = new Worker(new URL('dist/wall-art-worker.js', document.baseURI), { type: 'module' });
      const ask = (seed, lang) => new Promise((resolve) => { const id = seed * 10 + (lang === 'en' ? 1 : 0); const on = (e) => { if (e.data.id === id) { worker.removeEventListener('message', on); resolve(e.data); } }; worker.addEventListener('message', on); worker.postMessage({ type: 'plan', id, seed, lang, walls }); });
      const out = [];
      for (let seed = 1; seed <= 24; seed++) for (const lang of ['de', 'en']) out.push(await ask(seed, lang));
      worker.terminate();
      return out;
    });
    const all = (lang) => new Set(Object.values(plans.find((p) => p.lang === lang).allowed).flat());
    const de = all('de'), en = all('en');
    const deOnly = [...de].filter((x) => !en.has(x)), enOnly = [...en].filter((x) => !de.has(x));
    const bad = [];
    for (const p of plans) {
      const allowed = p.lang === 'en' ? en : de, foreign = new Set(p.lang === 'en' ? deOnly : enOnly);
      for (const wd of [...p.words, ...p.throws]) if (!allowed.has(wd) || foreign.has(wd) || !/^[A-ZÄÖÜ]+$/.test(wd)) bad.push([p.seed, p.lang, wd]);
      if (p.lang === 'en' && [...p.words, ...p.throws].some((wd) => /[ÄÖÜ]/.test(wd))) bad.push([p.seed, 'umlaut']);
    }
    const sample = plans.filter((p) => p.seed <= 3).map((p) => `${p.seed}${p.lang}: ${[...p.words, ...p.throws].join(' ')}`);
    note('graffiti words', sample);
    check('graffiti: every piece and throw-up of 24 variants is in the words of its language (no German word in English)', bad.length === 0 && plans.every((p) => p.words.length >= 4), bad.slice(0, 10));
    check('graffiti: the English murals use English words of their own (not word for word)', plans.filter((p) => p.lang === 'en').every((p) => p.words.some((wd) => enOnly.includes(wd))), plans.filter((p) => p.lang === 'en').map((p) => p.words.join(' ')).slice(0, 3));

    // live: the mural follows the language, the old one stays until the new one is there
    const info = () => ev(() => window.__app.world.walls.info());
    const untilMural = async (lang, ms = 25000) => { const t0 = Date.now(); for (;;) { const i = await info(); if (i.shown === 'graffiti' && i.muralLang === lang && i.muralSeed === 1 && !i.painting) return { ...i, waited: Date.now() - t0 }; if (Date.now() - t0 > ms) return { ...i, waited: -1 }; await sleep(60); } };
    await ev(() => window.api.settings.set({ walls: { style: 'graffiti', seed: 1 }, language: 'de' }));
    const g1 = await untilMural('de');
    check('graffiti: German mural on the walls', g1.waited >= 0, { waited: g1.waited, words: g1.plan?.words });
    await sleep(800);
    const VIEW = [['hall', 0, 3.6, 0, 0.1], ['room', 0, -11.6, 0, 0.22]];
    const pics = async (tag) => {
      await ev(() => { window.__app.world.stop(); });
      for (const [name, x, z, yaw, pitch] of VIEW) { await ev(([x, z, yaw, pitch]) => { window.__ix2.pose(x, z, yaw, pitch); for (let i = 0; i < 6; i++) window.__app.world.frame(); }, [x, z, yaw, pitch]); await shot(`ix2-graffiti-${tag}-${name}`); }
      await ev(() => window.__app.world.start());
    };
    await pics('de');
    // the mural's repaint on its own (the walls told the language directly): frames while the worker paints and the new
    // walls go onto the graphics card a strip per frame, next to a window without anything
    const repaint = async (lang) => {
      const fr = ev(() => window.__ix2.frames(6000));
      await ev((l) => window.__app.world.walls.setLanguage(l), lang);
      const g = await untilMural(lang);
      return { frames: await fr, waited: g.waited, paintMs: g.paintMs, totalMs: g.totalMs, strips: g.uploadMs?.length, stripMax: Math.max(0, ...(g.uploadMs || [])) };
    };
    // Frame times say something only on a quiet machine: a window without anything comes first, and a try counts when
    // that window has no frame over 50 ms and no long task. Up to three tries, German and English in turn.
    const tries = [];
    let lang = 'de';
    for (let k = 0; k < 3; k++) {
      const load = await waitQuiet();
      const idle = await ev(() => window.__ix2.frames(4000));
      lang = lang === 'de' ? 'en' : 'de';
      const rp = await repaint(lang);
      tries.push({ load, idle, counts: idle.over50 === 0 && idle.long.length === 0 && !idle.libMs.length && !rp.frames.libMs.length, ...rp });
      note(`graffiti repaint (mural only) ${k + 1}`, tries[k]);
      if (tries[k].counts && rp.frames.over50 === 0 && rp.frames.long.length === 0) break;
    }
    if (lang !== 'de') await repaint('de');
    const triesTable = tries.map((x) => ({ counts: x.counts, quiet: [x.idle.max, x.idle.over50, x.idle.long.length], repaint: [x.frames.max, x.frames.over50], long: x.frames.long, frameMs: x.frames.frameMs, stripMax: x.stripMax, load: [x.load.util, x.load.cpu] }));
    const countedTries = tries.filter((x) => x.counts);
    if (countedTries.length) check(`graffiti: repainting the mural costs no frame over 50 ms (worker, a strip per frame onto the card), ${countedTries.length} of ${tries.length} tries on a quiet machine`, countedTries.some((x) => x.waited >= 0 && x.stripMax < 8 && x.frames.over50 === 0 && x.frames.long.length === 0), triesTable);
    else skip('graffiti: frames over 50 ms while the mural is repainted', `the machine was busy with other programs: no try had a quiet window ${JSON.stringify(triesTable)}`);
    check('graffiti: the repainted mural came onto the walls every time, its strips onto the card', tries.every((x) => x.waited >= 0 && x.strips > 0), tries.map((x) => [x.waited, x.strips]));

    // the whole switch to English through the settings: the walls follow, the old mural stays until the new one is
    // there; the signs, the plates and the directory are drawn again (world.relabel, as after a returned book)
    const samples = [];
    await ev(() => {   // how long drawing the signs again holds up the main thread
      const w = window.__app.world;
      if (Object.hasOwn(w, 'relabel')) return;
      w.relabel = function () { const t = performance.now(), r = Object.getPrototypeOf(this).relabel.call(this); window.__ix2relabelMs = Math.round(performance.now() - t); return r; };
    });
    const fr = ev(() => window.__ix2.frames(5000));
    await ev(() => window.api.settings.set({ language: 'en' }));
    let g2 = null;
    for (let i = 0; i < 150; i++) { const s = await info(); samples.push([s.shown, s.muralLang]); if (s.muralLang === 'en' && !s.painting) { g2 = s; break; } await sleep(60); }
    const frames = await fr;
    check('graffiti: switched to English, the walls paint the English mural', g2?.muralLang === 'en' && g2?.want?.lang === 'en', { words: g2?.plan?.words, samples: samples.length });
    check('graffiti: meanwhile the German mural stays on the walls (no white walls, no empty frame)', samples.every(([shown, lang]) => shown === 'graffiti' && (lang === 'de' || lang === 'en')), samples.slice(0, 6));
    note('graffiti: the whole language switch (mural, signs drawn again)', { ...frames, relabelMs: await ev(() => window.__ix2relabelMs) });
    note('graffiti english words', g2?.plan?.words);
    await sleep(1500);
    const signsEn = await ev(() => { const s = window.__app.world.signs; const keys = s.entries().map((e) => e.key).join('\n'); return { recent: /Recently read/.test(keys), zuletzt: /Zuletzt gelesen/.test(keys), bookRoom: /Book room/.test(keys) }; });
    const builds = await ev(() => window.__app.world.buildTimes.length);
    check('graffiti: the signs and the directory in English as well (drawn again on the shelves as they stand)', signsEn.recent && !signsEn.zuletzt && signsEn.bookRoom, signsEn);
    await pics('en');
    await ev(() => window.api.settings.set({ language: 'de' }));
    const g3 = await untilMural('de');
    await sleep(1500);
    const signsDe = await ev(() => { const keys = window.__app.world.signs.entries().map((e) => e.key).join('\n'); return { zuletzt: /Zuletzt gelesen/.test(keys), recent: /Recently read/.test(keys) }; });
    check('graffiti: back to German, the signs as well, without building the rooms again', g3.waited >= 0 && signsDe.zuletzt && !signsDe.recent && (await ev(() => window.__app.world.buildTimes.length)) === builds, { waited: g3.waited, signsDe });
    await ev(() => window.api.settings.set({ walls: { style: 'white', seed: 1 } }));
    await sleep(500);
  }

  // ======================================================== 5. the lecterns =====================================================
  if (parts.has('lectern')) {
    // the board of the e-reader's stand at the height and slope of the encyclopedia's, clear of the wall and its panelling
    const lec = await ev(() => {
      const w = window.__app.world;
      const board = (kind) => {
        const obj = w.static.children.find((o) => o.userData.placement?.kind === kind);
        let b = null; obj?.traverse((o) => { if (o.name === 'lectern-board') b = o; });
        if (!b) return null;
        obj.updateMatrixWorld(true);
        const e = b.matrixWorld.elements;   // the board's local y axis in the world: its slope
        let back = 1e9;
        obj.traverse((o) => {
          if (!o.isMesh) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox, m = o.matrixWorld.elements;
          for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const wz = m[2] * x + m[6] * y + m[10] * z + m[14]; if (wz < back) back = wz; }
        });
        return { y: +e[13].toFixed(4), tilt: +Math.acos(Math.min(1, e[5])).toFixed(4), backZ: +back.toFixed(3), at: [+obj.position.x.toFixed(2), +obj.position.z.toFixed(2)] };
      };
      const hall = w.layout.floors[0];
      return { wiki: board('lectern'), reader: board('ereader'), wall: +(hall.z - hall.d / 2).toFixed(3) };
    });
    note('lecterns', lec);
    check('lectern: the e-reader\'s board at the height and slope of the encyclopedia lectern', lec.wiki && lec.reader && Math.abs(lec.wiki.y - lec.reader.y) < 0.005 && Math.abs(lec.wiki.tilt - lec.reader.tilt) < 0.005, lec);
    // the panelling stands 11 cm out from the wall, its chair rail and skirting 14.5 cm
    check('lectern: the e-reader stand keeps clear of the wall and the panelling', lec.reader && lec.reader.backZ > lec.wall + 0.15, { backZ: lec.reader?.backZ, wall: lec.wall });
    // where a visitor stands to use it: the label, E opens the reading browser
    const use = await ev(async () => {
      const w = window.__app.world, c = window.__ix2;
      const pl = w.layout.placements.find((p) => p.kind === 'ereader');
      const [sx, sz] = pl.meta.standAt;
      c.pose(sx, sz, 0, Math.atan2(1.09 - 1.62, Math.abs(sz - pl.z)));
      const t = c.look();
      await new Promise((r) => setTimeout(r, 250));
      return { t, label: c.label(), stand: [sx, sz] };
    });
    check('lectern: aimed at from where a visitor stands it names the e-reader', use.t?.type === 'interact' && use.t.kind === 'browser' && /Lesegerät/.test(use.label.name), use);
    await ev(() => { window.__app.world.stop(); document.querySelector('#hud').style.opacity = '0'; for (let i = 0; i < 4; i++) window.__app.world.frame(); });
    await shot('ix2-lectern-reader-view');
    await ev(() => { document.querySelector('#hud').style.opacity = '1'; window.__app.world.start(); });
    await sleep(300);
    await ev(() => window.__ix2.look());
    await page.keyboard.press('e');
    let opened = false;
    for (let i = 0; i < 40 && !opened; i++) { opened = await ev(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === 'browser')); if (!opened) await sleep(150); }
    check('lectern: E at the e-reader opens the reading browser', opened);
    await ev(() => window.__app.closeAllPanels()); await sleep(800);
    // both lecterns from the hall, as in the picture of the wish, and from the side
    await ev(() => { window.__app.world.stop(); document.querySelector('#hud').style.opacity = '0'; window.__ix2.pose(-6.4, -3.2, -0.91, -0.42); for (let i = 0; i < 4; i++) window.__app.world.frame(); });
    await shot('ix2-lecterns');
    await ev(() => { window.__ix2.pose(-1.4, -4.25, 1.34, -0.25); for (let i = 0; i < 4; i++) window.__app.world.frame(); });
    await shot('ix2-lecterns-side');
    // the eye at the height of the boards, looking level between them: both boards lie on the middle row of the picture
    const level = await ev(() => {
      const w = window.__app.world, p = w.player;
      window.__ix2.pose(-4.15, -2.55, 0, 0);
      p.update = function (dt) { Object.getPrototypeOf(this).update.call(this, dt); this.camera.position.y = 1.07; };
      for (let i = 0; i < 4; i++) w.frame();
      const rows = {};
      for (const kind of ['lectern', 'ereader']) {
        const obj = w.static.children.find((o) => o.userData.placement?.kind === kind);
        let b = null; obj?.traverse((o) => { if (o.name === 'lectern-board') b = o; });
        if (b) { const v = new b.position.constructor().setFromMatrixPosition(b.matrixWorld).project(w.camera); rows[kind] = Math.round((1 - v.y) / 2 * innerHeight); }
      }
      return { rows, middle: Math.round(innerHeight / 2) };
    });
    await shot('ix2-lecterns-level');
    note('lecterns seen from the height of their boards', level);
    check('lectern: seen from the height of the boards both lie on the same row of the picture', level.rows.lectern !== undefined && Math.abs(level.rows.lectern - level.rows.ereader) <= 2 && Math.abs(level.rows.lectern - level.middle) <= 2, level);
    await ev(() => { delete window.__app.world.player.update; document.querySelector('#hud').style.opacity = '1'; window.__app.world.start(); });
  }

  // ======================================================== 3. lamps ============================================================
  if (parts.has('lamps')) {
    await ev(() => window.api.settings.set({ timeMode: 'fixed', fixedHour: 21.5 }));
    await sleep(600);
    const kinds = [...new Set(lampIds.map((l) => l.kind))];
    const lights0 = await ev(() => window.__ix2.points());
    const tested = [];
    for (const kind of kinds) {
      // the first lamp of this kind that can be aimed at from a free spot
      let aim = null, id = null;
      for (const l of lampIds.filter((x) => x.kind === kind)) { aim = await ev((id) => window.__ix2.aimLamp(id), l.id); if (aim) { id = l.id; break; } }
      if (!aim) { check(`lamps: a ${kind} can be aimed at`, false); continue; }
      await sleep(250);
      const lab0 = await ev(() => window.__ix2.label());
      const before = await ev((id) => window.__app.world.lampSwitch.info().lamps, id);
      await page.keyboard.press('e');
      await sleep(600);
      const off = await ev((id) => ({ lamps: window.__app.world.lampSwitch.info().lamps, look: window.__ix2.look(), label: window.__ix2.label(), points: window.__ix2.points() }), id);
      const me = off.lamps.find((l) => l.id === id), meBefore = before.find((l) => l.id === id);
      const others = off.lamps.filter((l) => l.id !== id);
      const othersSame = others.every((l) => { const b = before.find((x) => x.id === l.id); return l.on === b.on && l.texel === b.texel; });
      let storedOff = null;
      for (let i = 0; i < 20; i++) { storedOff = await ev(async () => (await window.api.settings.get()).lampsOff); if (storedOff?.includes(id)) break; await sleep(100); }
      // E again, then a click: back on, off, on
      await page.keyboard.press('e');
      await sleep(600);
      const on = await ev((id) => window.__app.world.lampSwitch.info().lamps.find((l) => l.id === id), id);
      await ev(() => window.__app.world.actions.act('Click'));
      await sleep(600);
      const clickOff = await ev((id) => window.__app.world.lampSwitch.info().lamps.find((l) => l.id === id), id);
      await ev(() => window.__app.world.actions.act('Click'));
      await sleep(600);
      const clickOn = await ev((id) => window.__app.world.lampSwitch.info().lamps.find((l) => l.id === id), id);
      tested.push(kind);
      check(`lamps: ${kind} (${id}): "${lab0.name} · ${lab0.key}", E switches it off: its light 0, its decals 0, its shade 0, the label "${off.label.key}"`,
        lab0.show && /Licht aus$/.test(lab0.key) && !me.on && me.texel === 0 && me.lights.every((x) => x === 0) && me.glows.every((x) => x === 0) && (meBefore.lights.some((x) => x > 0) || meBefore.glows.some((x) => x > 0)) && /Licht an$/.test(off.label.key) && off.look?.on === false,
        { before: meBefore, after: me, label: off.label });
      check(`lamps: ${kind}: only this lamp changed, the number of lights stays ${lights0}, the settings remember it`, othersSame && off.points === lights0 && storedOff?.includes(id), { points: off.points, stored: storedOff });
      check(`lamps: ${kind}: E again and a click switch it on, off and on`, on.on && on.texel === 255 && (on.lights.some((x) => x > 0) || on.glows.some((x) => x > 0)) && !clickOff.on && clickOff.texel === 0 && clickOn.on && clickOn.texel === 255, { on, clickOff, clickOn });
    }
    check('lamps: every kind of lamp in the house was switched (floor, table, reading, wall, pendant)', ['floorlamp', 'tablelamp', 'desklamp', 'sconce', 'pendant'].every((k) => tested.includes(k)), tested);

    // the cost of the look ray with and without the lamps (it runs every 50 ms)
    const cost = await ev(() => {
      const w = window.__app.world, a = w.actions, c = window.__ix2;
      const poses = [[-1.2, 2.6, 0.4, 0.25], [0, -12.5, 0, 0.35], [-6.5, 1.8, Math.PI / 2, 0.1], [1.6, -0.8, 0, -0.3], [0, -18, Math.PI, 0.45]];
      const run = () => { const t0 = performance.now(); for (let k = 0; k < 60; k++) for (const p of poses) { c.pose(...p); a.update(0.06); } return (performance.now() - t0) / (60 * poses.length); };
      run();
      const withLamps = run();
      const keep = a.pickables; a.pickables = keep.filter((p) => p.obj.userData.interact?.kind !== 'lamp');
      const without = run();
      a.pickables = keep;
      return { withLamps: +withLamps.toFixed(4), withoutLamps: +without.toFixed(4), pickables: keep.length };
    });
    note('lamps: look ray ms per call', cost);
    check('lamps: the look ray stays cheap with the lamps (under 0.5 ms a call)', cost.withLamps < 0.5, cost);

    // a rebuild of the world (another graphics quality builds everything again) and back: the lamp stays off
    await ev((id) => { const w = window.__app.world; w.lampSwitch.set(id, false); window.__app.world.opts.onLamps(w.lampSwitch.offList()); }, hallFloorLamp);
    await sleep(800);
    const reb = await ev(async (id) => {
      const w = window.__app.world, s = window.__app.state.settings, n0 = w.buildTimes.length;
      w.applySettings({ ...s, graphics: { ...s.graphics, quality: 'medium' } });
      await new Promise((r) => setTimeout(r, 700));
      const mid = { builds: w.buildTimes.length - n0, lamp: w.lampSwitch.info().lamps.find((l) => l.id === id) };
      w.applySettings(s);
      await new Promise((r) => setTimeout(r, 700));
      return { mid, back: { builds: w.buildTimes.length - n0, lamp: w.lampSwitch.info().lamps.find((l) => l.id === id) } };
    }, hallFloorLamp);
    check('lamps: through two rebuilds of the world the lamp stays off', reb.mid.builds >= 1 && reb.back.builds >= 2 && !reb.mid.lamp.on && reb.mid.lamp.texel === 0 && reb.mid.lamp.lights.every((x) => x === 0) && !reb.back.lamp.on && reb.back.lamp.texel === 0 && reb.back.lamp.lights.every((x) => x === 0), reb);

    // pictures at night: the fire corner with the floor lamp on and off, the reading corner of the book room with the
    // pendant above it on and off; how bright the picture is (the mean of a grid of pixels, read right after a frame)
    const luma = () => ev(() => {
      const w = window.__app.world; w.frame();
      const gl = w.renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
      let s = 0, n = 0;
      for (let y = 0.1; y < 0.95; y += 0.05) for (let x = 0.05; x < 0.96; x += 0.05) { gl.readPixels(Math.floor(x * W), Math.floor(y * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); s += 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]; n++; }
      return +(s / n).toFixed(1);
    });
    const corner = async (tag, lampId, pose) => {
      await ev(() => window.__app.world.stop());
      await ev(([id, on]) => { const w = window.__app.world; w.lampSwitch.set(id, on); }, [lampId, true]);
      await ev((p) => { window.__ix2.pose(...p); const w = window.__app.world; for (let i = 0; i < 8; i++) { w.frame(); } }, pose);
      await ev(() => { const w = window.__app.world; w.start(); }); await sleep(500); await ev(() => window.__app.world.stop());
      await ev(() => { document.querySelector('#hud').style.opacity = '0'; window.__app.world.frame(); });
      const on = await luma();
      await shot(`ix2-lamp-${tag}-on`);
      await ev(([id]) => window.__app.world.lampSwitch.set(id, false), [lampId]);
      await ev(() => window.__app.world.start()); await sleep(600); await ev(() => window.__app.world.stop());
      const off = await luma();
      await shot(`ix2-lamp-${tag}-off`);
      await ev(() => { document.querySelector('#hud').style.opacity = '1'; window.__app.world.start(); });
      return { on, off, darker: +(1 - off / on).toFixed(3) };
    };
    const pendant = lampIds.find((l) => l.id === 'pendant@0.00,3.40,-21.10')?.id || lampIds.filter((l) => l.kind === 'pendant').pop()?.id;
    const hallLuma = await corner('hall', hallFloorLamp, [-4.8, 1.9, 1.9, -0.18]);
    const roomLuma = await corner('room', pendant, [0, -18.6, 0, -0.32]);
    await ev((id) => window.__app.world.lampSwitch.set(id, true), pendant);
    check('lamps: at night the room gets visibly darker where a lamp goes off (floor lamp by the fire, pendant over the reading corner)', hallLuma.darker > 0.03 && roomLuma.darker > 0.05, { hall: hallLuma, room: roomLuma });
    // the hall floor lamp stays off for the restart phase
    await ev((id) => { const w = window.__app.world; w.lampSwitch.set(id, false); w.opts.onLamps(w.lampSwitch.offList()); }, hallFloorLamp);
    await ev(() => window.api.settings.set({ timeMode: 'real' }));
  }

  // ======================================================== 4. the book card ====================================================
  if (parts.has('card')) {
    const rows = [];
    for (const [W, H] of [[1600, 900], [1920, 1080], [2560, 1440]]) {
      const vp = await setViewport(W, H);
      await sleep(500);
      const r = await ev(async () => {
        const w = window.__app.world, c = window.__ix2;
        const e = [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y > 1.2 && x.pos.y < 1.8 && x.book.hasCover !== false && !x.book.coverGenerated) || [...w.books.entries.values()].find((x) => !x.hidden && x.pos.y > 1.2);
        c.pose(0, 2, 0, 0); c.look();
        w.actions.goToBook(e.book.id);
        c.look();
        await new Promise((res) => setTimeout(res, 900));
        const card = document.querySelector('#book-peek .peek-card'), cover = document.querySelector('#book-peek .peek-cover');
        if (!card || !document.querySelector('#book-peek').classList.contains('show')) return { missing: true };
        const R = card.getBoundingClientRect(), C = cover.getBoundingClientRect();
        // the book as seen: its middle (pulled out towards you) and a circle round its cover, on the screen
        const v = { x: e.pos.x + e.forward.x * 0.28, y: e.pos.y, z: e.pos.z + e.forward.z * 0.28 };
        const proj = (p) => { const q = { x: p.x, y: p.y, z: p.z, isVector3: true }; const m = w.camera.matrixWorldInverse.elements, pm = w.camera.projectionMatrix.elements; const x = m[0] * q.x + m[4] * q.y + m[8] * q.z + m[12], y = m[1] * q.x + m[5] * q.y + m[9] * q.z + m[13], z = m[2] * q.x + m[6] * q.y + m[10] * q.z + m[14]; const cx = pm[0] * x + pm[4] * y + pm[8] * z + pm[12], cy = pm[1] * x + pm[5] * y + pm[9] * z + pm[13], cw = pm[3] * x + pm[7] * y + pm[11] * z + pm[15]; return [(cx / cw * 0.5 + 0.5) * innerWidth, (1 - (cy / cw * 0.5 + 0.5)) * innerHeight, -z]; };
        const [bx, by, depth] = proj(v);
        const rad = (Math.max(e.h || 0.24, 0.24) / 2 + 0.04) / depth * (innerHeight / 2) / Math.tan(w.camera.fov * Math.PI / 360);
        return {
          title: e.book.title, vw: innerWidth, vh: innerHeight,
          card: { left: Math.round(R.left), right: Math.round(R.right), top: Math.round(R.top), bottom: Math.round(R.bottom) },
          cover: { w: Math.round(C.width), h: Math.round(C.height), off: Math.round((C.left + C.right) / 2 - (R.left + R.right) / 2) },
          book: { x: Math.round(bx), y: Math.round(by), r: Math.round(rad) },
        };
      });
      if (r.missing) { check(`card ${W}×${H}: shown`, false, r); continue; }
      const cx = r.vw / 2, cy = r.vh / 2;
      const overCross = cx > r.card.left - 12 && cx < r.card.right + 12 && cy > r.card.top - 12 && cy < r.card.bottom + 12;
      const bookBox = [r.book.x - r.book.r, r.book.y - r.book.r, r.book.x + r.book.r, r.book.y + r.book.r];
      const overBook = bookBox[2] > r.card.left && bookBox[0] < r.card.right && bookBox[3] > r.card.top && bookBox[1] < r.card.bottom;
      const row = { size: `${r.vw}×${r.vh}`, card: r.card, coverH: r.cover.h, coverW: r.cover.w, coverOff: r.cover.off, coverFrac: +(r.cover.h / r.vh).toFixed(3), cardFrac: +((r.card.bottom - r.card.top) / r.vh).toFixed(3), leftFrac: +(r.card.left / r.vw).toFixed(3), centreOff: Math.round((r.card.top + r.card.bottom) / 2 - cy), book: r.book };
      rows.push(row);
      check(`card ${row.size}: two fifths of the window high (cover ${row.coverFrac}, card ${row.cardFrac}), left edge at ${row.leftFrac} of the width, centred (${row.centreOff} px)`,
        row.coverFrac >= 0.38 && row.coverFrac <= 0.46 && row.leftFrac >= 0.58 && row.leftFrac <= 0.62 && Math.abs(row.centreOff) <= r.vh * 0.03 && r.card.right <= r.vw - 8, row);
      check(`card ${row.size}: neither over the crosshair nor over the book looked at`, !overCross && !overBook, { card: r.card, book: bookBox });
      // a cover narrower than the row of keys below it stands in the middle of the card
      check(`card ${row.size}: the cover in the middle of the card (${row.coverOff} px off, cover ${row.coverW} px wide, card ${r.card.right - r.card.left} px)`, Math.abs(row.coverOff) <= 1, row);
      if (W === 2560 || W === 1600) { await ev(() => window.__app.world.frame()); await shot(`ix2-card-${W}x${H}`); }
    }
    note('card rectangles', rows);
    await setViewport(1600, 900);
  }

  // ---- leave the state for the restart phase -------------------------------------------------------------------------------
  await ev(() => window.api.settings.set({ floor: 'terrazzo', language: 'de' }));
  for (let i = 0; i < 100; i++) { const fi = await ev(() => window.__app.world.floors.info()); if (fi.shown === 'terrazzo') break; await sleep(100); }
  await sleep(3200);   // the store writes at the latest 2.5 s after a change
  check('no renderer or page errors', errors.length === 0, errors.slice(0, 8));
  console.log(`SUMMARY interior2-check: ${passes} passed, ${fails} failed${skips ? `, ${skips} skipped (busy machine)` : ''}`);
};
