// A film in full screen, seated or standing: F in the world (not on a book), the "Vollbild" link of the mini player,
// keys inside (Space/K pause, Esc/F leave, nothing reaches the world), subtitles drawn in full screen, back to the
// screen (or to sound) with the world loop running again. The film is a canvas test pattern with a WebVTT track
// (data: address), so no network is needed. The window stays hidden: the Fullscreen API is not used in test runs,
// and the check makes sure the window never went full screen.
//   node build/screenshot.js film-fullscreen-check
module.exports = async ({ app, page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const waitFor = async (fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const press = async (k) => { await page.keyboard.press(k); await sleep(350); };
  const win = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); const b = w.getBounds(); return { full: w.isFullScreen(), x: b.x, w: b.width }; });

  // ---- boot -------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2500);
  }
  await sleep(1500);
  const before = await win();
  const info = await page.evaluate(() => window.api.app.info());
  check('test window is hidden and says so (app:info hidden)', info.hidden === true && !before.full, { info: { hidden: info.hidden }, before });

  const st = () => page.evaluate(() => {
    const p = globalThis.__cozyshelvesMediaPlayer, ov = document.querySelector('#film-full'), w = window.__app.world;
    const tracks = [...p.video.textTracks].map((t) => ({ mode: t.mode, active: t.activeCues?.length || 0 }));
    return {
      mode: p.mode, playing: !p.video.paused, parent: p.video.parentNode?.className || '', open: !!ov && !ov.classList.contains('hidden'),
      running: !!w.running, enabled: w.player.enabled, seated: !!w.player.seated, tracks, volume: +p.video.volume.toFixed(2), fsEl: !!document.fullscreenElement,
      panels: document.querySelectorAll('.panel-layer:not(.closing)').length, wheel: !!document.querySelector('.wheel.open, #wheel.open'),
    };
  });

  // ---- a film on the screen, with subtitles ------------------------------------------------------------------------------
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); let t = 0;
    const draw = () => {
      t++;
      ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 250); });
      g.fillStyle = '#101010'; g.fillRect(0, 250, 640, 110); g.fillStyle = '#f0f0f0'; g.font = 'bold 44px Georgia'; g.fillText('Cozy Shelves Testbild', 130, 320);
      g.fillStyle = '#ffcf40'; g.beginPath(); g.arc(320 + Math.sin(t / 10) * 200, 125, 40, 0, Math.PI * 2); g.fill();
    };
    draw(); window.__testTimer = setInterval(draw, 40);
    const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:59:00.000\nUntertitel im Vollbild\n';
    const subtitleUrl = 'data:text/vtt;base64,' + btoa(unescape(encodeURIComponent(vtt)));
    window.__app.ctx.media.setSubtitles(true);
    await window.__app.ctx.media.play({ id: 'ff-test', title: 'Testbild im Vollbild', channel: 'Cozy Shelves', topic: 'Heimkino', stream: c.captureStream(25), subtitleUrl }, { mode: 'screen' });
    window.__app.ctx.bus.emit('cinema:watch');
  });
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(1200);
  // stand in the hall, facing the screen, nothing aimed at (no book)
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(1.5, 0.4, Math.PI / 2, 0.1); w.player.update(0.001); w.actions.rayTimer = 0; w.actions.update(0.016); });   // player.update moves the camera along
  await sleep(1500);
  let s = await st();
  const hudLine = await page.evaluate(() => { const e = document.querySelector('#media-subs'); return e && !e.classList.contains('hidden') ? e.textContent : null; });
  check('film on the screen, world loop running, subtitles as the HUD line (track hidden)', s.mode === 'screen' && s.playing && s.running && s.tracks.some((t) => t.mode === 'hidden') && hudLine === 'Untertitel im Vollbild', { s, hudLine });
  // the cinema sets the sound by distance; far away it gets quieter
  const screenVol = s.volume;

  // ---- F opens the full screen ------------------------------------------------------------------------------------------------
  await press('f');
  s = await st();
  check('F (no book aimed at) opens the full screen: mode full, video in the overlay, loop stopped', s.open && s.mode === 'full' && /ff-video/.test(s.parent) && !s.running && !s.enabled, s);
  check('subtitles are shown in full screen (track "showing" with an active cue)', s.tracks.some((t) => t.mode === 'showing' && t.active > 0), s.tracks);
  check('full volume in full screen (no distance to the screen)', s.volume === 1 || s.volume >= screenVol, { screenVol, full: s.volume });
  // the mouse rests on the control row: the controls stay (SwiftShader can be slower than the idle timer)
  await page.mouse.move(800, 450); await page.mouse.move(820, 815); await sleep(500);
  await shot('ff-1-open-controls');
  const shown = await page.evaluate(() => !document.querySelector('#film-full').classList.contains('idle'));
  check('controls show while the mouse is on them', shown, shown);
  await page.mouse.move(800, 400);
  const ui = await page.evaluate(() => { const ov = document.querySelector('#film-full'); return { title: ov.querySelector('.ff-title').textContent, sub: ov.querySelector('.ff-sub').textContent, time: ov.querySelector('.ff-time').textContent, subsBtn: !ov.querySelector('.ff-subs').classList.contains('hidden'), exit: ov.querySelector('.ff-exit-label').textContent }; });
  check('overlay shows title, channel, time, subtitles button and "Vollbild verlassen"', ui.title === 'Testbild im Vollbild' && ui.sub === 'Cozy Shelves · Heimkino' && ui.subsBtn && ui.exit === 'Vollbild verlassen', ui);
  const w1 = await win();
  check('the window itself never went full screen and stayed off every display', !w1.full && w1.x === before.x && !s.fsEl, { before, now: w1, fsEl: s.fsEl });

  // keys inside: Space and K pause/resume, other keys do not reach the world
  await press('Space'); const sp1 = await st();
  await press('Space'); const sp2 = await st();
  await press('k'); const k1 = await st();
  await press('k'); const k2 = await st();
  check('Space and K pause and resume the film in full screen', !sp1.playing && sp2.playing && !k1.playing && k2.playing && sp2.open && k2.open, { sp1: sp1.playing, sp2: sp2.playing, k1: k1.playing, k2: k2.playing });
  const pose0 = await page.evaluate(() => { const p = window.__app.world.player.position; return [p.x, p.z]; });
  for (const k of ['v', 'b', 'e', 'i', 'Tab', 'g', 'm']) await press(k);
  await page.keyboard.down('w'); await sleep(600); await page.keyboard.up('w');
  const leak = await st();
  const pose1 = await page.evaluate(() => { const p = window.__app.world.player.position; return [p.x, p.z]; });
  check('no key reaches the world while the film is in full screen', leak.open && leak.panels === 0 && pose0[0] === pose1[0] && pose0[1] === pose1[1], { panels: leak.panels, pose0, pose1 });
  // controls fade out after a while without mouse movement
  await sleep(3200);
  const idle = await page.evaluate(() => document.querySelector('#film-full').classList.contains('idle'));
  await shot('ff-2-idle-subtitles');
  check('controls fade out while the film plays and the mouse rests', idle, idle);

  // ---- Esc leaves, back to the screen, the loop runs again ---------------------------------------------------------------------------
  await press('Escape');
  s = await st();
  // the loop draws again (the first frames after a pause can take seconds under SwiftShader)
  const frames0 = await page.evaluate(() => window.__app.world.time);
  await waitFor((t0) => window.__app.world.time > t0 + 0.05, frames0, 30000);
  const frames1 = await page.evaluate(() => window.__app.world.time);
  check('Esc closes it: mode screen, video parked, film still running, world loop runs again', !s.open && s.mode === 'screen' && /media-parking/.test(s.parent) && s.playing && s.running && s.enabled && frames1 > frames0, { s, frames0, frames1 });
  check('back on the screen the subtitles are read for the HUD line again', s.tracks.some((t) => t.mode === 'hidden'), s.tracks);
  // the screen was still rolling down when F was pressed: the cloth comes down, then the picture fades in
  await waitFor(() => { const c = window.__app.world.cinema; return c.drop >= 1 && c.picture >= 0.99; }, null, 30000);
  await sleep(600);
  const cin = await page.evaluate(() => { const c = window.__app.world.cinema; return { active: c.active, drop: c.drop, picture: +c.picture.toFixed(2), texture: !!c.texture, map: c.pictureMat.map === c.texture, tainted: c.tainted }; });
  check('the screen in the hall shows the film again (texture on the same video)', cin.active && cin.drop >= 1 && cin.picture >= 0.99 && cin.texture && cin.map && !cin.tainted, cin);
  await shot('ff-3-back-in-the-hall');   // the running loop has drawn the hall again

  // ---- F again closes with F -------------------------------------------------------------------------------------------------------------
  await press('f'); const f1 = await st();
  await press('f'); const f2 = await st();
  check('F opens and F closes again', f1.open && f1.mode === 'full' && !f2.open && f2.mode === 'screen' && f2.running, { f1: { open: f1.open, mode: f1.mode }, f2: { open: f2.open, mode: f2.mode, running: f2.running } });

  // ---- seated on the sofa --------------------------------------------------------------------------------------------------------------------
  await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('sofa'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('sofa'); });
  await sleep(1800);
  await press('f');
  const seatedOpen = await st();
  await press('Escape');
  const seatedBack = await st();
  check('seated on the sofa: F opens the full screen, Esc returns, still seated', seatedOpen.open && seatedOpen.seated && !seatedBack.open && seatedBack.seated && seatedBack.mode === 'screen', { seatedOpen: { open: seatedOpen.open, seated: seatedOpen.seated }, seatedBack: { open: seatedBack.open, seated: seatedBack.seated, mode: seatedBack.mode } });
  await page.evaluate(() => window.__app.world.actions.stand());
  await sleep(1200);

  // ---- from sound only: the mini player's "Vollbild" link -------------------------------------------------------------------------------------
  await page.evaluate(() => window.__app.ctx.media.setMode('audio'));
  await sleep(500);
  await page.click('#media-bar .mb-full', { timeout: 60000 });
  await sleep(400);
  const fromAudio = await st();
  // like a user: the mouse goes to the button (the controls fade in and stay while it rests on them), then the click
  const exitBox = await page.locator('#film-full .ff-exit').boundingBox();
  await page.mouse.move(700, 400);
  await page.mouse.move(exitBox.x + exitBox.width / 2, exitBox.y + exitBox.height / 2);
  await page.click('#film-full .ff-exit', { timeout: 60000 });
  await sleep(400);
  const backAudio = await st();
  check('"Vollbild" in the mini player opens it from sound only, the exit button returns to sound', fromAudio.open && fromAudio.mode === 'full' && !backAudio.open && backAudio.mode === 'audio' && backAudio.playing, { fromAudio: { open: fromAudio.open, mode: fromAudio.mode }, backAudio: { open: backAudio.open, mode: backAudio.mode, playing: backAudio.playing } });

  // ---- F on a book stays "Info" ------------------------------------------------------------------------------------------------------------------
  // the loop rests meanwhile: an aimed book slides out of the shelf, and the next ray could miss it for a frame
  const bookInfo = await page.evaluate(async () => {
    const w = window.__app.world;
    w.stop();
    const e = [...w.books.entries.values()].find((x) => !x.hidden);
    w.actions.goToBook(e.book.id);
    w.frame(); w.actions.rayTimer = 0; w.actions.update(0.01);
    return { target: w.actions.target?.type, id: e.book.id };
  });
  await press('f');
  await sleep(800);
  const onBook = await st();
  const infoPanel = await page.evaluate(() => [...document.querySelectorAll('.panel-layer:not(.closing)')].map((l) => l.dataset.panel));
  check('F on a book opens its info card, not the film', bookInfo.target === 'book' && !onBook.open && infoPanel.includes('bookinfo'), { bookInfo, open: onBook.open, infoPanel });
  await page.evaluate(() => { window.__app.closeAllPanels(); window.__app.world.start(); });
  await sleep(500);

  // ---- the film ends in full screen or is stopped: the view closes by itself ----------------------------------------------------------------------
  await page.evaluate(() => window.__app.ctx.media.setMode('screen'));
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(1.5, 0.4, Math.PI / 2, 0.1); w.player.update(0.001); w.actions.rayTimer = 0; w.actions.update(0.016); });   // player.update moves the camera along
  await sleep(600);
  await press('f');
  const beforeStop = await st();
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  await sleep(400);
  const afterStop = await st();
  check('stopping the film closes the full screen and restarts the loop', beforeStop.open && !afterStop.open && !afterStop.mode && afterStop.running && afterStop.enabled, { beforeStop: beforeStop.open, afterStop });
  // without a film F does nothing
  await press('f');
  const noFilm = await st();
  check('without a film F does nothing', !noFilm.open && noFilm.panels === 0, noFilm);

  const w2 = await win();
  check('the window never went full screen during the whole run', !w2.full && w2.x === before.x, w2);
  await page.evaluate(() => clearInterval(window.__testTimer));
  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`FILM-FULLSCREEN-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
