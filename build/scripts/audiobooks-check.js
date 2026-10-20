// Audiobooks: an audiobook folder added in the settings (the system dialog answers with the test folder), the panel with
// its covers, playback (the media element's time advances; the run is muted), a jump to a chapter, the speed, ±15/30 s,
// the sleep timer (shortened through player.testTime) also to the end of a chapter, the mini player and the media keys,
// the cabinet in the hall (boxes with covers, the card "Alle Hörbücher", E plays a box, F opens it), the language
// switch and no renderer errors. The cabinet stands before the first folder as well (0.7.1): empty, its label says
// "Hörbücher · E Öffnen", E or a click opens the panel; the first folder fills it without a rebuild of the world.
// AB_PHASE=restart with the same COZYSHELVES_USERDATA checks that the position, the speed and "Weiterhören" survive a
// restart, then removes the folder: the cabinet stays and empties.
//   node build/screenshot.js audiobooks-check        (COZYSHELVES_BOOKS, COZYSHELVES_USERDATA, SHOT_DIR; AB_LIB = the test
//   audiobooks, made with build/testlib/gen_audiobooks.js --extra 22 when missing; AB_SHOTS=0 takes no pictures;
//   AB_SIZE=2560x1440 sets the window to that size, for pictures as the user sees them; AB_VIEWS='[["name", x, z, yaw,
//   pitch], …]' adds pictures of the hall with the cabinet from those places, without the HUD)
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, page, shot, sleep }) => {
  const phase = process.env.AB_PHASE || 'main';
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/pointer lock|ERR_|net::|favicon|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });
  const waitFor = async (fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const shots = process.env.AB_SHOTS !== '0';
  const pic = async (name) => { if (shots) await shot(name); };
  const userData = process.env.COZYSHELVES_USERDATA || '';
  const lib = path.resolve(process.env.AB_LIB || (userData ? userData.replace(/[\\/]+$/, '') + '-audiobooks' : 'ab-testlib'));
  const memo = path.join(process.env.SHOT_DIR || '.', 'audiobooks-check-memo.json');
  if (!fs.existsSync(lib)) { require('../testlib/gen_audiobooks').generate(lib, { extra: 22 }); console.log('[ab] test audiobooks written to', lib); }
  if (process.env.AB_SIZE) {
    const [w, h] = process.env.AB_SIZE.split('x').map(Number);
    const got = await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win?.setContentSize(w, h); return win?.getContentSize(); }, [w, h]);
    console.log('[ab] window', got);
  }

  // ---- boot ---------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(1500);
  }
  await sleep(1200);
  await page.evaluate(() => { window.__app.world.stop(); window.__app.closeAllPanels(); });
  await page.evaluate(() => {
    const w = window.__app.world, p = w.player;
    window.__ab = {
      P: globalThis.__cozyshelvesAudiobookPlayer,
      frames(n = 4) { for (let i = 0; i < n; i++) w.frame(); },
      key(code, key, extra = {}) { const o = { code, key, bubbles: true, cancelable: true, ...extra }; document.dispatchEvent(new KeyboardEvent('keydown', o)); document.dispatchEvent(new KeyboardEvent('keyup', o)); },
      look() { p.update(0.001); w.scene.updateMatrixWorld(); w.camera.updateMatrixWorld(); w.actions.rayTimer = 0; w.actions.update(0.001); const t = w.actions.target; return t ? { type: t.type, kind: t.kind || null, id: t.id || null } : null; },
      aim(x, z, yaw, pitch) { if (w.actions.seatedId || p.seated) w.actions.leaveSeat(); p.transition = null; p.setPose(x, z, yaw, pitch); return this.look(); },
      panels() { return [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel); },
      /** draw calls, triangles and the median GPU and CPU time of a frame looking at the cabinet's place */
      async measure() {
        const r = w.renderer, gl = r.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (w.actions.seatedId || p.seated) w.actions.leaveSeat();
        p.transition = null; p.setPose(4.47, -3.05, 0, -0.22);
        for (let i = 0; i < 12; i++) w.frame();
        const gpu = [], cpu = [];
        r.info.autoReset = false;
        let calls = 0, triangles = 0;
        for (let i = 0; i < 40; i++) {
          r.info.reset();
          let q = null; if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
          const a = performance.now(); w.frame(); cpu.push(performance.now() - a);
          calls = r.info.render.calls; triangles = r.info.render.triangles;
          if (q) {
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            for (let k = 0; k < 300 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); k++) await new Promise((res) => setTimeout(res, 2));
            if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
        }
        r.info.autoReset = true;
        const med = (a) => (a.length ? +[...a].sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(3) : null);
        return { calls, triangles, gpuMs: med(gpu), cpuMs: med(cpu) };
      },
      /** the cabinet as it stands: in the hall, its boxes, its collider, the cat's grid, the place "Hörbücher" */
      cabinet() {
        const s = w.audiobooks, c = s.caseObj;
        if (!c) return null;
        const x = c.position.x, z = c.position.z;
        return {
          stands: !!c.parent, boxes: s.group.visible ? s.slots.length : 0, visible: s.group.visible, slots: s.slots.length,
          collider: w.colliders.some((k) => x > k.min[0] && x < k.max[0] && z > k.min[2] && z < k.max[2] && k.max[1] > 1.2),
          catGrid: w.cat ? !w.cat.nav.freeAt(x, z) : null, place: w.places.some((pl) => pl.id === 'audiobooks'), builds: (w.buildTimes || []).length,
        };
      },
      /** aim at the cabinet's frame from in front of it (beside the boxes: its plate) */
      aimCabinet() {
        const c = w.audiobooks.caseObj; c.updateMatrixWorld(true);
        const fx = Math.sin(c.rotation.y), fz = Math.cos(c.rotation.y);
        const t = this.aim(c.position.x + fx * 1.3, c.position.z + fz * 1.3, Math.atan2(fx, fz), Math.atan2(1.48 - 1.62, 1.3));
        return { t, name: document.querySelector('#look-label .ll-name')?.textContent || '', what: document.querySelector('#look-label .ll-what')?.textContent || '', shown: document.querySelector('#look-label')?.classList.contains('show') };
      },
      st() { const s = this.P.state; return { id: s.book?.id || null, title: s.book?.title || null, playing: s.playing, t: +this.P.audio.currentTime.toFixed(2), pos: +s.position.toFixed(2), track: s.track, chapter: s.chapter, rate: s.rate, vol: +this.P.audio.volume.toFixed(3), sleep: s.sleep, error: s.error }; },
    };
  });
  const ab = (fn, arg) => page.evaluate(fn, arg);
  // the handlers of the system media controls, as media/media-session.js sets them when the source changes
  await ab(() => { const msn = navigator.mediaSession, orig = msn.setActionHandler.bind(msn); window.__msH = {}; msn.setActionHandler = (n, fn) => { window.__msH[n] = fn; return orig(n, fn); }; });
  const waitPlaying = (ms = 15000) => waitFor(() => { const a = window.__ab.P.audio; return !a.paused && a.currentTime > 0.6; }, null, ms);

  if (phase === 'restart') return restart();

  // ---- 1. the folder through the settings --------------------------------------------------------------------------
  // the better of two rounds (the graphics card is shared with other programs)
  const best = (a, b) => ({ calls: b.calls, triangles: b.triangles, gpuMs: Math.min(a.gpuMs ?? Infinity, b.gpuMs ?? Infinity), cpuMs: Math.min(a.cpuMs, b.cpuMs) });
  const perf0 = best(await ab(() => window.__ab.measure()), await ab(() => window.__ab.measure()));
  // a few frames first: what the world compiles on its own by then is not counted
  for (let i = 0; i < 10; i++) { await ab(() => window.__ab.frames(2)); await sleep(50); }
  const before = await ab(() => { window.__progKeys = new Set((window.__app.world.renderer.info.programs || []).map((p) => p.cacheKey)); return { programs: window.__app.world.renderer.info.programs?.length || 0, cabinet: window.__ab.cabinet() }; });
  check('without an audiobook folder the cabinet stands in the hall, empty: its collider, the cat\'s grid and the place "Hörbücher" know it', before.cabinet?.stands && before.cabinet.boxes === 0 && before.cabinet.collider && before.cabinet.catGrid !== false && before.cabinet.place, before.cabinet);
  // looking at the empty cabinet: its label and key; E opens the panel, which offers to add a folder
  const look0 = await ab(() => window.__ab.aimCabinet());
  check('aimed at the empty cabinet: "Hörbücher · E Öffnen"', look0.t?.type === 'interact' && look0.t.kind === 'audiobooks' && look0.shown && look0.name === 'Hörbücher' && look0.what === 'Öffnen', look0);
  await ab(() => document.querySelector('#hud')?.style.setProperty('opacity', '0'));
  await ab(() => { const w = window.__app.world, c = w.audiobooks.caseObj, fx = Math.sin(c.rotation.y), fz = Math.cos(c.rotation.y), p = w.player; p.transition = null; p.setPose(c.position.x + fx * 2.3 - 0.9, c.position.z + fz * 2.3, Math.atan2(fx, fz) - 0.3, -0.12); window.__ab.frames(6); });
  await pic('ab-00-cabinet-empty');
  await ab(() => document.querySelector('#hud')?.style.setProperty('opacity', '1'));
  await ab(() => window.__ab.aimCabinet());
  await ab(() => window.__ab.key('KeyE', 'e'));
  const empty = await waitFor(() => [...document.querySelectorAll('.ab-empty button')].some((b) => /Hörbuchordner hinzufügen/.test(b.textContent)), null, 10000);
  await sleep(400);
  await pic('ab-00-empty');
  check('E on the empty cabinet opens the panel; without a folder it explains it and offers "Hörbuchordner hinzufügen"', empty);
  await ab(() => window.__app.closeAllPanels());
  await sleep(500);
  // a click does the same (the pointer counts as caught: the test window cannot catch it)
  await ab(() => { window.__ab.aimCabinet(); const p = window.__app.world.player; p.locked = true; document.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); p.locked = false; });
  const clicked = await waitFor(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].some((l) => l.dataset.panel === 'audiobooks'), null, 8000);
  check('a click on the empty cabinet opens the panel as well', clicked);
  await ab(() => window.__app.closeAllPanels());
  await sleep(500);
  await ab(() => window.__app.ctx.api.settings.set({ language: 'en' }));
  await waitFor(() => window.__app.state.settings?.language === 'en');
  await sleep(500);
  const lookEn = await ab(() => window.__ab.aimCabinet());
  await ab(() => window.__app.ctx.api.settings.set({ language: 'de' }));
  await waitFor(() => window.__app.state.settings?.language === 'de');
  await sleep(500);
  check('English: "Audiobooks · E Open"', lookEn.name === 'Audiobooks' && lookEn.what === 'Open', lookEn);
  await app.evaluate(({ dialog }, dir) => { dialog.__abOrig = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, lib);
  await ab(() => window.__app.openPanel('settings', { section: 'audiobooks' }));
  await waitFor(() => [...document.querySelectorAll('.settings-panel button')].some((b) => /Hörbuchordner hinzufügen/.test(b.textContent)));
  await page.evaluate(() => [...document.querySelectorAll('.settings-panel button')].find((b) => /Hörbuchordner hinzufügen/.test(b.textContent)).click());
  const found = await waitFor(() => { const s = window.__app.ctx; void s; return document.querySelector('.ab-set-status')?.textContent.includes('30 Hörbücher'); }, null, 60000);
  const setText = await ab(() => ({ status: document.querySelector('.ab-set-status')?.textContent, folders: [...document.querySelectorAll('.ab-set-folders .path')].map((e) => e.textContent) }));
  check('"Hörbuchordner hinzufügen" in the settings: the folder is listed, 30 audiobooks found', found && setText.folders.length === 1, setText);
  await pic('ab-0-settings');
  await app.evaluate(({ dialog }) => { if (dialog.__abOrig) dialog.showOpenDialog = dialog.__abOrig; });
  await ab(() => window.__app.closeAllPanels());

  // ---- 2. the cabinet in the hall -----------------------------------------------------------------------------------
  // the boxes come into the cabinet that stands: no rebuild of the world, no long frame
  await ab(() => { const w = window.__app.world; window.__abFill = { builds: (w.buildTimes || []).length, frames: [] }; window.__abTick = setInterval(() => { const t = performance.now(); w.frame(); window.__abFill.frames.push(performance.now() - t); }, 50); });
  await waitFor(() => window.__app.world.audiobooks.caseObj?.parent && window.__app.world.audiobooks.slots.length === 24 && window.__app.world.audiobooks.group.visible, null, 20000);
  await waitFor(() => window.__app.world.audiobooks.loading === 0, null, 20000);
  await sleep(600);
  const fill = await ab(() => { clearInterval(window.__abTick); const w = window.__app.world, f = window.__abFill.frames; return { rebuilds: (w.buildTimes || []).length - window.__abFill.builds, frames: f.length, max: +Math.max(0, ...f).toFixed(1), stands: !!w.audiobooks.caseObj?.parent }; });
  check('the first folder fills the cabinet without a rebuild of the world and without a long frame', fill.stands && fill.rebuilds === 0 && fill.frames > 5 && fill.max < 150, fill);
  for (let i = 0; i < 30; i++) { await ab(() => window.__ab.frames(2)); await sleep(60); }
  const cab = await ab(() => {
    const s = window.__app.world.audiobooks;
    const progs = window.__app.world.renderer.info.programs || [];
    // which material holds a new program (scene, composer passes and their full-screen quads)
    const owner = (prog) => {
      const r = window.__app.world.renderer, out = [], seen = new Set();
      const visit = (m, where) => { if (!m?.isMaterial || seen.has(m)) return; seen.add(m); const p = r.properties.get(m); if (p?.currentProgram === prog || (p?.programs && [...p.programs.values()].includes(prog))) out.push(where + ':' + (m.name || m.type)); };
      window.__app.world.scene.traverse((o) => { for (const m of [o.material].flat()) visit(m, o.name || o.type); });
      for (const pass of window.__app.world.composer.passes) for (const [k, v] of Object.entries(pass)) { visit(v, pass.constructor.name + '.' + k); visit(v?.material, pass.constructor.name + '.' + k + '.material'); if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) { visit(v2, pass.constructor.name + '.' + k + '.' + k2); } }
      return out.join(',') || '?';
    };
    const fresh = progs.filter((p) => !window.__progKeys.has(p.cacheKey)).map((p) => owner(p) + ' ' + p.cacheKey.replace(/\s+/g, ' ').slice(0, 120));
    return { slots: s.slots.length, all: !!s.slots[23]?.all, books: s.slots.filter((x) => x.book).length, visible: s.group.visible, programs: progs.length, fresh, place: window.__app.world.places.some((x) => x.id === 'audiobooks') };
  });
  check('the cabinet stands in the hall: 23 boxes and the card "Alle Hörbücher" (30 audiobooks)', cab.visible && cab.slots === 24 && cab.books === 23 && cab.all && cab.place, cab);
  check('no new shader program for the cabinet and its boxes', !cab.fresh.some((f) => /audiobook/i.test(f)), { before: before.programs, after: cab.programs, fresh: cab.fresh });
  // after the covers arrived and the rebuild's textures went up
  await waitFor(() => window.__app.world.audiobooks.loading === 0 && !window.__app.world.audiobooks.atlasDirty, null, 20000);
  for (let i = 0; i < 20; i++) { await ab(() => window.__ab.frames(3)); await sleep(50); }
  const perf1 = best(await ab(() => window.__ab.measure()), await ab(() => window.__ab.measure()));
  check('the cabinet costs a few draw calls and triangles at most (looking at it)', perf1.calls - perf0.calls <= 10 && perf1.triangles - perf0.triangles <= 4000, { before: perf0, after: perf1 });

  // pictures from free places, without the HUD
  const views = JSON.parse(process.env.AB_VIEWS || '[]');
  if (views.length && shots) {
    await waitFor(() => window.__app.world.audiobooks.loading === 0, null, 20000);
    await ab(() => document.querySelector('#hud')?.style.setProperty('opacity', '0'));
    for (const [name, x, z, yaw, pitch] of views) {
      await ab(([x, z, yaw, pitch]) => { const w = window.__app.world, p = w.player; p.transition = null; p.setPose(x, z, yaw, pitch || 0); }, [x, z, yaw, pitch]);
      for (let i = 0; i < 8; i++) { await ab(() => window.__ab.frames(2)); await sleep(60); }
      await shot('ab-view-' + name);
    }
    await ab(() => document.querySelector('#hud')?.style.setProperty('opacity', '1'));
  }

  // ---- 3. the panel -------------------------------------------------------------------------------------------------
  await ab(() => window.__ab.key('KeyH', 'h'));
  await waitFor(() => document.querySelectorAll('.ab-card').length === 30);
  await waitFor(() => [...document.querySelectorAll('.ab-card img')].every((i) => i.complete && i.naturalWidth > 0), null, 20000);
  const grid = await ab(() => {
    const cards = [...document.querySelectorAll('.ab-card')];
    const books = window.__ab.P && globalThis.__cozyshelvesAudiobookPlayer ? null : null; void books;
    return { n: cards.length, lfile: cards.filter((c) => c.querySelector('img')?.src.startsWith('lfile:')).length, titles: cards.slice(0, 3).map((c) => c.querySelector('.ab-card-title').textContent), cont: !!document.querySelector('.ab-continue'), panel: window.__ab.panels() };
  });
  check('the panel lists all 30 audiobooks, every cover loaded from a picture of the folders', grid.n === 30 && grid.lfile === 30 && grid.panel.includes('audiobooks'), grid);
  check('no "Weiterhören" before anything was heard', !grid.cont, grid.cont);
  await sleep(300);
  await pic('ab-1-panel');

  // ---- 4. one audiobook: its page, play, a chapter, speed, skips ----------------------------------------------------
  await ab(() => [...document.querySelectorAll('.ab-card')].find((c) => c.querySelector('.ab-card-title').textContent === 'Der Leuchtturmwärter').click());
  await waitFor(() => document.querySelectorAll('.ab-chap').length === 5);
  const page1 = await ab(() => ({ title: document.querySelector('.ab-book-title')?.textContent, by: document.querySelector('.ab-book-by')?.textContent, chapters: [...document.querySelectorAll('.ab-chap-title')].map((e) => e.textContent) }));
  check('the page of an audiobook: title, author and narrator, its five chapters (CD1 before CD2)', page1.title === 'Der Leuchtturmwärter' && /Jonas Beispiel/.test(page1.by) && /Max Sprecher/.test(page1.by) && page1.chapters.join('|') === 'Ankunft|Der Turm|Das Licht|Der Sturm|Heimkehr', page1);
  await ab(() => document.querySelector('.ab-ctl.main').click());
  const started = await waitPlaying();
  let s = await ab(() => window.__ab.st());
  check('play: the audio element\'s time advances (muted run)', started && s.playing && s.title === 'Der Leuchtturmwärter', s);
  const focus = await ab(() => globalThis.__cozyshelvesMediaFocus.active());
  const music = await ab(() => ({ duck: [...(window.__app.ctx.audio.duckers || [])], hold: [...(window.__app.ctx.audio.holders || [])] }));
  check('one source at a time: the audiobook has the focus, the background music gives way', focus === 'audiobook' && music.duck.includes('audiobook') && music.hold.includes('audiobook'), { focus, music });
  await ab(() => document.querySelector('.ab-chap[data-i="3"]').click());
  await waitFor(() => window.__ab.P.state.track === 3 && window.__ab.P.audio.currentTime > 0.5 && !window.__ab.P.audio.paused, null, 15000);
  s = await ab(() => window.__ab.st());
  const cStart = await ab(() => window.__ab.P.chapterStart(3));
  check('a click on a chapter jumps there (the fourth file, on CD2) and plays on', s.track === 3 && s.chapter === 3 && Math.abs(s.pos - cStart) < 3 && s.playing, { s, cStart });
  await pic('ab-2-player');
  await ab(() => document.querySelector('.ab-rate').click());
  await waitFor(() => document.querySelector('.ab-menu'));
  await ab(() => [...document.querySelectorAll('.ab-menu-item')].find((b) => b.textContent === '1,5×').click());
  await sleep(300);
  s = await ab(() => window.__ab.st());
  check('speed 1,5×: the element plays faster, the button says so', s.rate === 1.5 && (await ab(() => window.__ab.P.audio.playbackRate)) === 1.5 && (await ab(() => document.querySelector('.ab-rate').textContent)) === '1,5×', s.rate);
  const p0 = (await ab(() => window.__ab.st())).pos;
  await ab(() => window.__ab.key('ArrowRight', 'ArrowRight')); await sleep(400);
  const p1 = (await ab(() => window.__ab.st())).pos;
  await ab(() => window.__ab.key('ArrowLeft', 'ArrowLeft')); await sleep(400);
  const p2 = (await ab(() => window.__ab.st())).pos;
  check('→ jumps 30 s forward, ← 15 s back (into the next file and back)', p1 - p0 > 27 && p1 - p0 < 33.5 && p1 - p2 > 12.5 && p1 - p2 < 16.5, { p0, p1, p2 });
  await ab(() => window.__ab.key('Space', ' ')); await sleep(400);
  const paused = await ab(() => window.__ab.st());
  await ab(() => window.__ab.key('Space', ' ')); await sleep(500);
  const resumed = await ab(() => window.__ab.st());
  check('Space pauses and plays', !paused.playing && resumed.playing, { paused: paused.playing, resumed: resumed.playing });

  // ---- 5. sleep timer ----------------------------------------------------------------------------------------------
  // a minute lasts 0.4 s and the fade 3 s here: "15 Minuten" stops after 6 s of listening
  await ab(() => { window.__ab.P.testTime = { minute: 0.4, fade: 3 }; window.__ab.P.setRate(1); });
  await ab(() => document.querySelector('.ab-sleep').click());
  await waitFor(() => document.querySelector('.ab-menu'));
  await ab(() => {
    window.__vols = []; const a = window.__ab.P.audio;
    [...document.querySelectorAll('.ab-menu-item')].find((b) => /^15 Minuten$/.test(b.textContent)).click();
    const t0 = performance.now();
    const tm = setInterval(() => { window.__vols.push([Math.round(performance.now() - t0), +a.volume.toFixed(3), !a.paused]); if (a.paused) clearInterval(tm); }, 100);
  });
  // the volume over time, recorded in the page (the calls from here are slow on a busy machine)
  await waitFor(() => (window.__vols || []).some((v) => !v[2]), null, 25000);
  const vols = await ab(() => window.__vols || []);
  const stopped = vols.find(([, , pl]) => !pl)?.[0] ?? null;
  const fading = vols.filter(([t, v, pl]) => pl && t > 3200 && v < 0.9).length;
  const after = await ab(() => window.__ab.st());
  check('sleep timer "15 Minuten": the volume fades in the last part, then the audiobook stops; the volume is back', stopped && stopped > 5000 && stopped < 9000 && fading >= 10 && after.vol > 0.95 && !after.sleep, { stopped, fading, sample: vols.filter((_, i) => i % 8 === 0), after: after.vol });
  const sleepBtnOff = await ab(() => document.querySelector('.ab-sleep').textContent);
  // to the end of the chapter: 3 s before its end, it stops where the next one begins
  const cEnd = await ab(() => { const P = window.__ab.P; const i = P.state.chapter; const e = P.state.chapterEnd; P.seek(e - 3, { play: true }); return { i, e }; });
  await waitPlaying();
  await ab(() => window.__ab.P.setSleep('chapter'));
  const stopAt = await waitFor(() => window.__ab.P.audio.paused && !window.__ab.P.state.sleep, null, 12000);
  s = await ab(() => window.__ab.st());
  check('sleep timer "bis Kapitelende": stops at the end of the chapter', stopAt && !s.playing && Math.abs(s.pos - cEnd.e) < 0.8 && !s.sleep, { s, cEnd, sleepBtnOff });
  await ab(() => { window.__ab.P.testTime = null; });

  // ---- 6. the mini player, K / J / L, the media keys --------------------------------------------------------------
  await ab(() => window.__ab.P.resume());
  await waitPlaying();
  await ab(() => window.__app.closeAllPanels());
  await sleep(400);
  const bar = await ab(() => { const b = document.querySelector('#media-bar'); return { visible: !b.classList.contains('hidden'), audiobook: b.classList.contains('audiobook'), title: b.querySelector('.mb-title').textContent, sub: b.querySelector('.mb-sub').textContent, art: !!b.querySelector('.mb-icon img'), foot: [...b.querySelectorAll('.mb-foot .mb-label')].map((e) => e.textContent), keys: b.querySelector('.mb-keys').textContent }; });
  check('the mini player shows the audiobook: cover, title, author and chapter, "Hörbücher" and "Beenden", 15 s · 30 s', bar.visible && bar.audiobook && bar.art && bar.title === 'Der Leuchtturmwärter' && /Jonas Beispiel/.test(bar.sub) && bar.foot.join('|') === 'Hörbücher|Beenden' && /15 s · 30 s/.test(bar.keys), bar);
  await ab(() => window.__ab.frames(2));
  await pic('ab-3-miniplayer');
  const k0 = await ab(() => window.__ab.st());
  await ab(() => window.__ab.key('KeyK', 'k')); await sleep(350);
  const k1 = await ab(() => window.__ab.st());
  await ab(() => window.__ab.key('KeyK', 'k')); await sleep(450);
  const j0 = (await ab(() => window.__ab.st())).pos;
  await ab(() => window.__ab.key('KeyL', 'l')); await sleep(300);
  const j1 = (await ab(() => window.__ab.st())).pos;
  await ab(() => window.__ab.key('KeyJ', 'j')); await sleep(300);
  const j2 = (await ab(() => window.__ab.st())).pos;
  check('K pauses and plays, L jumps 30 s forward, J 15 s back', k0.playing && !k1.playing && j1 - j0 > 27 && j1 - j2 > 13 && j1 - j2 < 16.5, { k0: k0.playing, k1: k1.playing, j0, j1, j2 });
  const ms = await ab(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, album: navigator.mediaSession.metadata?.album, state: navigator.mediaSession.playbackState }));
  check('the system media overlay names the audiobook, its author and chapter', ms.title === 'Der Leuchtturmwärter' && ms.artist === 'Jonas Beispiel' && !!ms.album && ms.state === 'playing', ms);
  const keysMs = await ab(async () => {
    const H = window.__msH, P = window.__ab.P, wait = () => new Promise((r) => setTimeout(r, 450));
    if (!H.nexttrack || !H.seekforward) return { missing: Object.keys(H) };
    P.seekChapter(1, { play: true }); await wait();
    const c0 = P.state.chapter; H.nexttrack({ action: 'nexttrack' }); await wait();
    const c1 = P.state.chapter; H.previoustrack({ action: 'previoustrack' }); await wait();
    const c2 = P.state.chapter;
    const f0 = P.state.position; H.seekforward({ action: 'seekforward' }); await wait();
    const f1 = P.state.position; H.seekbackward({ action: 'seekbackward' }); await wait();
    return { c0, c1, c2, step: +(f1 - f0).toFixed(1), back: +(f1 - P.state.position).toFixed(1) };
  });
  check('media keys: "nächster/vorheriger Titel" go to the chapters, the seek keys 30 s forward and 15 s back', keysMs.c1 === keysMs.c0 + 1 && keysMs.c2 === keysMs.c0 && keysMs.step > 28 && keysMs.step < 33 && keysMs.back > 13 && keysMs.back < 17, keysMs);

  // ---- 6b. WAV and FLAC; at the end of a file the next one follows ---------------------------------------------------
  const idOf = (title) => ab(async (t) => (await window.__app.ctx.api.invoke('audiobooks:state')).books.find((x) => x.title === t)?.id, title);
  const wavId = await idOf('Erzählungen am Kamin');
  await ab((id) => window.__ab.P.open(id, { at: 0 }), wavId);
  await waitPlaying();
  const d0 = await ab(() => window.__ab.P.state.book.tracks[0].duration);
  await ab((d) => window.__ab.P.seek(d - 1.2, { play: true }), d0);
  const nextFile = await waitFor(() => window.__ab.P.state.track === 1 && !window.__ab.P.audio.paused && window.__ab.P.audio.currentTime > 0.3, null, 15000);
  s = await ab(() => window.__ab.st());
  check('WAV: at the end of a file the next one follows by itself', nextFile && s.title === 'Erzählungen am Kamin' && s.chapter === 1, s);
  const flacId = await idOf('Sterne über dem See');
  await ab((id) => window.__ab.P.open(id), flacId);
  const flacPlays = await waitPlaying();
  await ab(() => window.__ab.P.seekChapter(2));
  await waitFor(() => window.__ab.P.state.chapter === 2 && !window.__ab.P.audio.paused, null, 10000);
  s = await ab(() => window.__ab.st());
  const flacChapters = await ab(() => window.__ab.P.state.book.chapters.map((c) => c.title));
  check('FLAC plays, with the chapters of its Vorbis comments', flacPlays && s.chapter === 2 && Math.abs(s.t - 100) < 2 && flacChapters.join('|') === 'Dämmerung|Die ersten Sterne|Mitternacht', { s, flacChapters });
  await ab(() => window.__ab.P.pause());

  // ---- 7. the cabinet: a box under the crosshair, E, F, the card "Alle Hörbücher" ------------------------------------
  await ab(() => window.__ab.P.pause());
  await ab(() => { window.__app.ctx.world.teleport('audiobooks'); });
  await sleep(1300);
  await ab(() => window.__ab.frames(6));
  await pic('ab-4-cabinet');
  const night = await ab(() => {
    const s = window.__app.world.audiobooks, id = (window.__app.ctx.state && null) || null; void id;
    const want = s.slots.findIndex((x) => x.book?.title === 'Die lange Nacht');
    const v = s.viewOf(want, 1.0);
    const t = window.__ab.aim(v.x, v.z, v.yaw, v.pitch);
    for (let i = 0; i < 6; i++) s.update(0.05);
    return { want, t, hover: s.hover, peek: null };
  });
  await sleep(500);
  const card = await ab(() => { const p = document.querySelector('#book-peek'); return { show: p.classList.contains('show'), ab: !!p.querySelector('.ab-peek'), keys: p.querySelector('.peek-keys')?.textContent || '', img: p.querySelector('img')?.src?.slice(0, 8) }; });
  check('a box under the crosshair: it is the target, it tips forward, its card shows the cover and "E Abspielen"', night.t?.type === 'audiobook' && night.hover === night.want && card.show && card.ab && /E\s*Abspielen/.test(card.keys) && /F\s*Details/.test(card.keys), { night, card });
  await ab(() => window.__ab.frames(3));
  await page.evaluate(() => document.querySelector('#hud')?.style.setProperty('opacity', '1'));
  await pic('ab-5-cabinet-card');
  await ab(() => window.__ab.key('KeyE', 'e'));
  const eplay = await waitFor(() => window.__ab.P.state.book?.title === 'Die lange Nacht' && !window.__ab.P.audio.paused && window.__ab.P.audio.currentTime > 0.5, null, 15000);
  const toast = await ab(() => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '));
  check('E on the box plays that audiobook (a single M4B with chapters); a note names it', eplay && /Die lange Nacht/.test(toast), { toast });
  const m4b = await ab(() => ({ chapters: window.__ab.P.state.book.chapters.map((c) => c.title), track: window.__ab.P.state.track }));
  check('the M4B brings its five chapters', m4b.chapters.join('|') === 'Prolog|Erstes Kapitel|Zweites Kapitel|Drittes Kapitel|Epilog', m4b);
  await ab(() => window.__ab.P.seekChapter(2));
  await waitFor(() => window.__ab.P.state.chapter === 2 && !window.__ab.P.audio.paused, null, 10000);
  s = await ab(() => window.__ab.st());
  check('a chapter inside the M4B: the position moves within the one file', s.chapter === 2 && s.track === 0 && Math.abs(s.t - 300) < 2, s);
  await ab(() => window.__ab.look());
  const cardPause = await ab(() => { window.__app.world.actions.update(0.06); return document.querySelector('#book-peek .peek-keys')?.textContent || ''; });
  check('while it plays the card says "E Pause"', /E\s*Pause/.test(cardPause), cardPause);
  await ab(() => window.__ab.key('KeyE', 'e')); await sleep(350);
  check('E on the playing box pauses it', !(await ab(() => window.__ab.st())).playing);
  await ab(() => window.__ab.key('KeyF', 'f'));
  const fOpen = await waitFor(() => document.querySelector('.ab-book-title')?.textContent === 'Die lange Nacht', null, 8000);
  check('F on the box opens its page in the panel', fOpen);
  await pic('ab-6-m4b-page');
  await ab(() => window.__app.closeAllPanels()); await sleep(400);
  const allCard = await ab(() => {
    const s = window.__app.world.audiobooks; const v = s.viewOf(23, 1.0);
    const t = window.__ab.aim(v.x, v.z, v.yaw, v.pitch);
    return { t, label: document.querySelector('#look-label')?.textContent };
  });
  await ab(() => window.__ab.key('KeyE', 'e'));
  const allOpen = await waitFor(() => document.querySelectorAll('.ab-card').length === 30 && !document.querySelector('.ab-book'), null, 8000);
  await sleep(600);
  check('the card "Alle Hörbücher" in the last place opens the list of all audiobooks', allCard.t?.type === 'interact' && allCard.t.kind === 'audiobooks' && allOpen, allCard);
  const cont = await ab(() => [...document.querySelectorAll('.ab-cont-title')].map((e) => e.textContent));
  check('"Weiterhören" lists what was begun, the last one first', cont[0] === 'Die lange Nacht' && cont.includes('Der Leuchtturmwärter'), cont);
  await pic('ab-7-continue');

  // ---- 8. language, theme ----------------------------------------------------------------------------------------------
  await ab(() => window.__app.ctx.api.settings.set({ language: 'en' }));
  await waitFor(() => document.querySelector('.ab-title')?.textContent === 'Audiobooks');
  const en = await ab(() => ({ title: document.querySelector('.ab-title')?.textContent, section: [...document.querySelectorAll('.ab-section')].map((e) => e.textContent), plate: window.__app.world.audiobooks.plate?.material?.map?.image ? 'drawn' : 'queued' }));
  check('English: the panel speaks English at once', en.title === 'Audiobooks' && en.section.some((t) => /Continue listening/i.test(t)), en);
  await ab(() => window.__app.ctx.api.settings.set({ language: 'de', ui: { theme: 'dark' } }));
  await waitFor(() => document.querySelector('.ab-title')?.textContent === 'Hörbücher');
  await sleep(500);
  await pic('ab-8-panel-dark');
  await ab(() => window.__app.ctx.api.settings.set({ ui: { theme: 'sepia' } }));

  // ---- 8b. the folder is watched: a new audiobook appears by itself, a removed one goes ----------------------------------
  const extraDir = path.join(lib, 'Neu eingetroffen');
  fs.rmSync(extraDir, { recursive: true, force: true });
  const W = require('../testlib/audiobook-writer');
  fs.mkdirSync(extraDir, { recursive: true });
  for (let i = 1; i <= 2; i++) fs.writeFileSync(path.join(extraDir, `0${i}.wav`), W.wavFile({ seconds: 3, seed: 40 + i, info: { IPRD: 'Neu eingetroffen', IART: 'Erika Muster' } }));
  const appeared = await waitFor(() => document.querySelectorAll('.ab-card').length === 31 && [...document.querySelectorAll('.ab-card-title')].some((e) => e.textContent === 'Neu eingetroffen'), null, 45000);
  const allCount = await ab(() => window.__app.world.audiobooks.total);
  check('a new audiobook in the folder appears by itself (the folder is watched), the cabinet counts it', appeared && allCount === 31, { appeared, allCount });
  fs.rmSync(extraDir, { recursive: true, force: true });
  const gone = await waitFor(() => document.querySelectorAll('.ab-card').length === 30, null, 45000);
  check('… and goes when it is removed', gone);

  // ---- 9. saved where the listener is ------------------------------------------------------------------------------------
  const saved = await ab(async () => { const s = await window.__app.ctx.api.invoke('audiobooks:state'); return s.books.filter((b) => b.progress).map((b) => ({ id: b.id, title: b.title, pos: b.progress.position, rate: b.progress.rate, track: b.progress.track, offset: b.progress.offset })); });
  const nightSaved = saved.find((b) => b.title === 'Die lange Nacht');
  check('the position is saved in the main process', !!nightSaved && nightSaved.pos > 290, saved);
  // a speed of its own for "Die lange Nacht", for the restart
  await ab(() => window.__ab.P.setRate(1.25));
  await ab(() => window.__ab.P.pause());
  await sleep(1500);
  const final = await ab(async () => { const s = await window.__app.ctx.api.invoke('audiobooks:state'); const b = s.books.find((x) => x.title === 'Die lange Nacht'); return { id: b.id, pos: b.progress.position, rate: b.progress.rate, at: Date.now() }; });
  fs.writeFileSync(memo, JSON.stringify(final));
  check('no renderer errors', errors.length === 0, errors.slice(0, 6));
  summary();

  async function restart() {
    const m = JSON.parse(fs.readFileSync(memo, 'utf8'));
    await waitFor(() => window.__app.world.audiobooks.caseObj?.parent && window.__app.world.audiobooks.slots.length === 24, null, 30000);
    const first = await ab(() => window.__app.world.audiobooks.slots[0]?.book?.title);
    check('after a restart the cabinet stands at once, the audiobook heard last in its first place', first === 'Die lange Nacht', first);
    await ab(() => window.__ab.key('KeyH', 'h'));
    await waitFor(() => document.querySelectorAll('.ab-cont').length > 0);
    const cont = await ab(() => [...document.querySelectorAll('.ab-cont')].map((c) => ({ title: c.querySelector('.ab-cont-title').textContent, left: c.querySelector('.ab-cont-left').textContent })));
    check('"Weiterhören" after the restart', cont[0]?.title === 'Die lange Nacht', cont);
    await pic('ab-9-restart-panel');
    await ab(() => document.querySelector('.ab-cont .ab-cont-play').click());
    await waitPlaying();
    const s = await ab(() => window.__ab.st());
    const gap = (Date.now() - m.at) / 1000;
    const back = gap < 10 ? 0 : gap < 300 ? 3 : 8;
    check('the position survives the restart (a few seconds earlier), with its own speed', s.title === 'Die lange Nacht' && Math.abs(s.pos - (m.pos - back)) < 1.5 + 1.25 * 1.2 && s.rate === 1.25, { s, saved: m, back });
    // the last folder removed in the settings: the cabinet stays where it is and empties, nothing is rebuilt
    await ab(() => { window.__ab.P.pause(); window.__app.closeAllPanels(); });
    const builds = await ab(() => (window.__app.world.buildTimes || []).length);
    await ab(() => window.__app.openPanel('settings', { section: 'audiobooks' }));
    await waitFor(() => [...document.querySelectorAll('.ab-set-folders button')].some((b) => /Entfernen/.test(b.textContent)), null, 10000);
    await ab(() => [...document.querySelectorAll('.ab-set-folders button')].find((b) => /Entfernen/.test(b.textContent))?.click());
    // (the world loop rests in this check: a frame on every try)
    const emptied = await waitFor(() => { window.__ab.frames(1); return window.__app.world.audiobooks.slots.length === 0 && !window.__app.world.audiobooks.group.visible; }, null, 20000);
    await ab(() => window.__app.closeAllPanels());
    await sleep(500);
    const after = await ab(() => window.__ab.cabinet());
    check('the last folder removed: the cabinet stays and empties, without a rebuild of the world', emptied && after.stands && after.boxes === 0 && after.collider && after.place && after.builds === builds, { emptied, after, builds });
    const look = await ab(() => window.__ab.aimCabinet());
    await ab(() => window.__ab.key('KeyE', 'e'));
    const offer = await waitFor(() => [...document.querySelectorAll('.ab-empty button')].some((b) => /Hörbuchordner hinzufügen/.test(b.textContent)), null, 10000);
    check('… and E on it opens the panel, which offers "Hörbuchordner hinzufügen" again', look.what === 'Öffnen' && offer, { look, offer });
    await pic('ab-10-removed');
    await ab(() => window.__app.closeAllPanels());
    check('no renderer errors', errors.length === 0, errors.slice(0, 6));
    summary();
  }
  function summary() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\naudiobooks-check (${phase}): ${results.length - failed.length} passed, ${failed.length} failed${failed.length ? ': ' + failed.map((f) => f.name).join('; ') : ''}`);
  }
};
