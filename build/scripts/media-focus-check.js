// One source at a time, the mini player for podcasts, the system media controls, no automatic sitting, Space to
// stand up and, standing, to jump (never a panel or play/pause). Offline: the podcast is a silent WAV made in the page (blob:), the film a canvas test pattern
// (captureStream, as in cinema-check), the read-aloud voice a stand-in worker that returns silence (no model
// download). Runs muted and hidden like every harness script.
//   node build/screenshot.js media-focus-check
module.exports = async ({ page, shot, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const waitFor = async (fn, arg, ms = 15000) => { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };
  const key = async (code, k) => {
    await page.evaluate(([code, key]) => document.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true })), [code, k]);
    await sleep(120);
    await page.evaluate(([code, key]) => document.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true })), [code, k]);
    await sleep(250);
  };

  // ---- boot -------------------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.menu-btn.primary').click());
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => ({ n: window.__app.state.library.books.length, active: !!window.__app.state.library.scan?.active }));
    if (!st.active && st.n > 0) break;
    await sleep(2500);
  }
  await sleep(1500);
  // the loop only costs time here (SwiftShader); frames are drawn by hand where a picture is needed
  await page.evaluate(() => window.__app.world.stop());

  const state = () => page.evaluate(() => {
    const pod = globalThis.__cozyshelvesPodcastPlayer, film = globalThis.__cozyshelvesMediaPlayer, focus = globalThis.__cozyshelvesMediaFocus;
    const bar = document.querySelector('#media-bar');
    return {
      pod: { loaded: !!pod.current, playing: !pod.audio.paused, t: +pod.audio.currentTime.toFixed(1) },
      film: { loaded: !!film.current, playing: !film.video.paused, mode: film.mode },
      order: focus.order, active: focus.active(['film', 'podcast']),
      // since 0.6 every action shows its key cap: keys reads "K Pause · J L 15 s", foot holds the labels of the actions
      bar: { visible: !bar.classList.contains('hidden'), podcast: bar.classList.contains('podcast'), title: bar.querySelector('.mb-title').textContent, sub: bar.querySelector('.mb-sub').textContent, art: !!bar.querySelector('.mb-icon img'), keys: [...bar.querySelectorAll('.mb-keys > *')].map((e) => [...e.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + e.querySelector('.mb-label').textContent).join(' · '), foot: [...bar.querySelectorAll('.mb-foot .mb-link .mb-label')].map((b) => b.textContent) },
    };
  });

  // ---- test media: a silent WAV (podcast) and a canvas pattern (film) ------------------------------------------------
  await page.evaluate(() => {
    const rate = 8000, secs = 240, n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    window.__wav = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    const art = document.createElement('canvas'); art.width = art.height = 96;
    const g = art.getContext('2d'); g.fillStyle = '#c98c34'; g.fillRect(0, 0, 96, 96); g.fillStyle = '#2b1a08'; g.font = 'bold 40px Georgia'; g.fillText('TP', 18, 62);
    window.__episode = { id: 'focus-test-ep', title: 'Folge 7: Die Sterne im Herbst', audio: window.__wav, duration: secs };
    window.__show = { title: 'Testpodcast der Bücherei', artwork: art.toDataURL('image/png'), feedUrl: '', author: 'Cozy Shelves' };
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const cg = c.getContext('2d'); let t = 0;
    const draw = () => { t++; ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => { cg.fillStyle = col; cg.fillRect(i * 640 / 7, 0, 640 / 7 + 1, 360); }); cg.fillStyle = '#ffcf40'; cg.beginPath(); cg.arc(320 + Math.sin(t / 10) * 200, 180, 40, 0, Math.PI * 2); cg.fill(); };
    draw(); window.__testTimer = setInterval(draw, 40);
    window.__filmItem = { id: 'focus-test-film', title: 'Testbild', channel: 'Cozy Shelves', stream: c.captureStream(25) };
    globalThis.__cozyshelvesPodcastPlayer.attach(window.__app.ctx);
  });

  // ---- a) podcast playing → a film starts → the podcast pauses --------------------------------------------------------
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.play(window.__episode, window.__show));
  const podStarted = await waitFor(() => { const a = globalThis.__cozyshelvesPodcastPlayer.audio; return !a.paused && a.currentTime > 0.5; });
  let s = await state();
  check('podcast plays (silent WAV from a blob: address)', podStarted && s.pod.playing, s.pod);
  check('mini player shows the podcast: episode, show, artwork, keys, links', s.bar.visible && s.bar.podcast && s.bar.title === 'Folge 7: Die Sterne im Herbst' && s.bar.sub === 'Testpodcast der Bücherei' && s.bar.art && /J L 15 s/.test(s.bar.keys) && s.bar.foot.join('|') === 'Podcasts|Beenden', s.bar);
  await page.evaluate(() => window.__app.world.frame());
  await shot('focus-1-podcast-bar');

  await page.evaluate(() => window.__app.ctx.media.play(window.__filmItem, { mode: 'screen' }));
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(600);
  s = await state();
  check('film starts → podcast paused (still loaded)', s.film.playing && !s.pod.playing && s.pod.loaded && s.active === 'film', { pod: s.pod, film: s.film, order: s.order });
  check('mini player follows the film', s.bar.visible && !s.bar.podcast && s.bar.title === 'Testbild' && s.bar.foot.includes('Vollbild'), s.bar);

  // ---- b) film playing → the podcast starts → the film pauses --------------------------------------------------------
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesPodcastPlayer.audio.paused);
  await sleep(600);
  s = await state();
  check('podcast starts → film paused (still loaded, still on the screen)', s.pod.playing && !s.film.playing && s.film.loaded && s.film.mode === 'screen' && s.active === 'podcast', { pod: s.pod, film: s.film, order: s.order });
  check('mini player shows the podcast again', s.bar.visible && s.bar.podcast, s.bar);

  // ---- c) the mini player's buttons act on the podcast -----------------------------------------------------------------
  await page.click('#media-bar .mb-play'); await sleep(500);
  const afterPause = await state();
  await page.click('#media-bar .mb-play'); await sleep(700);
  const afterPlay = await state();
  check('mini player play/pause button pauses and resumes the podcast', !afterPause.pod.playing && afterPlay.pod.playing && !afterPlay.film.playing, { afterPause: afterPause.pod, afterPlay: afterPlay.pod });
  const t0 = (await state()).pod.t;
  await page.click('#media-bar .mb-btn:not(.mb-play) >> nth=1'); await sleep(400);   // ↻ +15 s
  const t1 = (await state()).pod.t;
  await page.click('#media-bar .mb-btn:not(.mb-play) >> nth=0'); await sleep(400);   // ↺ −15 s
  const t2 = (await state()).pod.t;
  check('mini player ±15 s buttons skip the podcast', t1 - t0 >= 13 && t1 - t2 >= 13, { t0, t1, t2 });
  // seeking on the progress bar: a click at 50 % → half of 240 s
  const box = await page.locator('#media-bar .mb-progress').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2); await sleep(400);
  const tSeek = (await state()).pod.t;
  check('clicking the progress bar seeks the podcast', Math.abs(tSeek - 120) < 6, { tSeek });

  // ---- d) K / J / L in the world act on the active source --------------------------------------------------------------
  await key('KeyK', 'k'); const kPause = await state();
  await key('KeyK', 'k'); await sleep(300); const kPlay = await state();
  check('K toggles the podcast', !kPause.pod.playing && kPlay.pod.playing, { kPause: kPause.pod, kPlay: kPlay.pod });
  const j0 = (await state()).pod.t;
  await key('KeyL', 'l'); const j1 = (await state()).pod.t;
  await key('KeyJ', 'j'); await key('KeyJ', 'j'); const j2 = (await state()).pod.t;
  check('L / J skip the podcast by 15 s', j1 - j0 >= 13 && j1 - j2 >= 27, { j0, j1, j2 });
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(400);
  const filmActive = await state();
  await key('KeyK', 'k'); const kf1 = await state();
  await key('KeyK', 'k'); await sleep(300); const kf2 = await state();
  check('with the film active, K toggles the film (the podcast stays paused)', filmActive.active === 'film' && !filmActive.pod.playing && !kf1.film.playing && kf2.film.playing && !kf2.pod.playing, { filmActive: filmActive.active, kf1: kf1.film, kf2: kf2.film, pod: kf2.pod });

  // ---- e) system media controls (navigator.mediaSession) ----------------------------------------------------------------
  // watch setActionHandler: the handlers are set again whenever the active source changes
  await page.evaluate(() => {
    const ms = navigator.mediaSession; const orig = ms.setActionHandler.bind(ms);
    window.__msHandlers = {};
    ms.setActionHandler = (name, fn) => { window.__msHandlers[name] = fn; return orig(name, fn); };
  });
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesPodcastPlayer.audio.paused);
  await sleep(500);
  const ms1 = await page.evaluate(() => ({ handlers: Object.keys(window.__msHandlers).filter((k) => window.__msHandlers[k]), title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, art: navigator.mediaSession.metadata?.artwork?.length || 0, state: navigator.mediaSession.playbackState }));
  check('media session: podcast metadata, playing, handlers set', ms1.title === 'Folge 7: Die Sterne im Herbst' && ms1.artist === 'Testpodcast der Bücherei' && ms1.art === 1 && ms1.state === 'playing' && ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack'].every((h) => ms1.handlers.includes(h)), ms1);
  await page.evaluate(() => window.__msHandlers.pause({ action: 'pause' })); await sleep(400);
  const msPause = await state();
  const msState = await page.evaluate(() => navigator.mediaSession.playbackState);
  await page.evaluate(() => window.__msHandlers.play({ action: 'play' })); await sleep(700);
  const msPlay = await state();
  const n0 = msPlay.pod.t;
  await page.evaluate(() => window.__msHandlers.nexttrack({ action: 'nexttrack' })); await sleep(300);
  const n1 = (await state()).pod.t;
  await page.evaluate(() => window.__msHandlers.seekbackward({ action: 'seekbackward' })); await sleep(300);
  const n2 = (await state()).pod.t;
  check('media keys pause / play / next / seek back act on the podcast', !msPause.pod.playing && msState === 'paused' && msPlay.pod.playing && n1 - n0 >= 13 && n1 - n2 >= 13, { paused: msPause.pod.playing, msState, played: msPlay.pod.playing, n0, n1, n2 });
  // the film takes over the media session when it starts
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesMediaPlayer.video.paused);
  await sleep(500);
  const ms2 = await page.evaluate(() => ({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist, state: navigator.mediaSession.playbackState }));
  await page.evaluate(() => window.__msHandlers.pause({ action: 'pause' })); await sleep(400);
  const msf1 = await state();
  await page.evaluate(() => window.__msHandlers.play({ action: 'play' })); await sleep(600);
  const msf2 = await state();
  check('media session follows the film: metadata, pause and play', ms2.title === 'Testbild' && ms2.artist === 'Cozy Shelves' && ms2.state === 'playing' && !msf1.film.playing && msf2.film.playing && !msf2.pod.playing, { ms2, f1: msf1.film.playing, f2: msf2.film.playing, pod: msf2.pod.playing });

  // ---- f) read-aloud: a reading pauses the podcast, a podcast pauses the reading ---------------------------------------------
  // a stand-in for the Kokoro worker: every sentence comes back as 1.5 s of a quiet tone (no model, no download; plain
  // silence would be trimmed away by the client, tts-audio.js, and the reading would end at once; the harness is muted)
  await page.evaluate(() => {
    window.__RealWorker = window.Worker;
    window.Worker = class FakeTtsWorker {
      constructor() { this.onmessage = null; this.onerror = null; }
      // (0.7: the client first asks whether the English model is on this computer; the stand-in says it is)
      postMessage(m) { if (m?.type === 'cached') { setTimeout(() => this.onmessage?.({ data: { type: 'cached', id: m.id, cached: true, device: 'wasm', dtype: 'q8', bytes: 1 } }), 0); return; } if (m?.type === 'speak') setTimeout(() => { const samples = new Float32Array(36000); for (let i = 0; i < samples.length; i++) samples[i] = 0.05 * Math.sin(i * 0.0576); this.onmessage?.({ data: { type: 'audio', id: m.id, sampleRate: 24000, samples } }); }, 40); }
      terminate() {} addEventListener() {} removeEventListener() {}
    };
    window.__tts = null;
    window.__app.ctx.bus.on('tts:status', (st) => { window.__tts = { active: st.active, paused: st.paused, index: st.index }; });
  });
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesPodcastPlayer.audio.paused);
  await sleep(400);
  const beforeTts = await state();
  await page.evaluate(() => window.__app.ctx.bus.emit('tts:speak', { text: 'This is the first sentence of the test. Here comes the second one. A third sentence follows now. The fourth sentence is short. The fifth is the last but one. And this is the end.', lang: 'en' }));
  const ttsRuns = await waitFor(() => window.__tts?.active && window.__tts.index >= 0 && globalThis.__cozyshelvesPodcastPlayer.audio.paused, null, 20000);
  s = await state();
  check('read-aloud starts → podcast paused (and the film stays paused)', beforeTts.pod.playing && ttsRuns && !s.pod.playing && !s.film.playing && s.order[s.order.length - 1] === 'tts', { tts: await page.evaluate(() => window.__tts), pod: s.pod, film: s.film, order: s.order });
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.resume());
  await waitFor(() => !globalThis.__cozyshelvesPodcastPlayer.audio.paused);
  await sleep(500);
  const ttsHeld = await page.evaluate(() => window.__tts);
  s = await state();
  check('podcast resumes → read-aloud paused (not stopped)', s.pod.playing && ttsHeld?.active && ttsHeld?.paused, { tts: ttsHeld, pod: s.pod });
  await page.evaluate(() => { window.__app.ctx.bus.emit('tts:stop'); window.Worker = window.__RealWorker; });
  await sleep(300);

  // ---- g) "Beenden" in the mini player; the paused film comes back into the mini player --------------------------------------
  await page.click('#media-bar .mb-foot .mb-link >> text=Beenden'); await sleep(500);
  s = await state();
  check('"Beenden" stops the podcast, the mini player shows the paused film', !s.pod.loaded && s.bar.visible && !s.bar.podcast && s.bar.title === 'Testbild' && s.active === 'film', { pod: s.pod, bar: s.bar, active: s.active });
  const noChip = await page.evaluate(() => [...document.querySelectorAll('#hud-top-right .hud-chip')].map((c) => c.textContent));
  check('no separate podcast chip in the HUD any more', !noChip.some((t) => t.startsWith('▶')), noChip);

  // ---- h) cinema:watch: nobody is seated, the pose stays; outside the hall a note ------------------------------------------------
  const pose = await page.evaluate(() => { const w = window.__app.world; if (w.actions.seatedId) w.actions.leaveSeat(); w.player.transition = null; w.player.setPose(2.4, 1.3, 1.9, 0.05); return { x: w.player.position.x, z: w.player.position.z, yaw: w.player.yaw, pitch: w.player.pitch }; });
  await page.evaluate(() => window.__app.ctx.bus.emit('cinema:watch'));
  await sleep(1500);
  const afterWatch = await page.evaluate(() => { const w = window.__app.world; return { seated: w.player.seated, seatedId: w.actions.seatedId, x: w.player.position.x, z: w.player.position.z, yaw: w.player.yaw, pitch: w.player.pitch, transition: !!w.player.transition, toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent) }; });
  check('cinema:watch leaves world.player.seated null and the pose unchanged', afterWatch.seated === null && afterWatch.seatedId === null && !afterWatch.transition && Math.abs(afterWatch.x - pose.x) < 1e-6 && Math.abs(afterWatch.z - pose.z) < 1e-6 && Math.abs(afterWatch.yaw - pose.yaw) < 1e-6 && Math.abs(afterWatch.pitch - pose.pitch) < 1e-6, { pose, afterWatch });
  check('no note while standing in the hall', !afterWatch.toasts.some((t) => /Leinwand in der Halle/.test(t)), afterWatch.toasts);
  // the frame first (SwiftShader is slow), so that the note is still there for the picture
  await page.evaluate(() => { const w = window.__app.world; w.player.transition = null; w.player.setPose(0, -14, 0, 0); w.frame(); });
  await page.evaluate(() => window.__app.ctx.bus.emit('cinema:watch'));
  await sleep(500);
  await shot('focus-2-bookroom-note');
  const roomWatch = await page.evaluate(() => ({ seated: window.__app.world.player.seated, z: window.__app.world.player.position.z, toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent) }));
  check('in the book room: a note that the film runs on the screen in the hall, still standing', roomWatch.seated === null && roomWatch.z === -14 && roomWatch.toasts.includes('Der Film läuft auf der Leinwand in der Halle.'), roomWatch);

  // ---- i) Space stands up, Q does nothing, Space while standing jumps -------------------------------------------------------------
  await page.evaluate(() => { const w = window.__app.world; const s = w.seats.get('table1a'); w.player.transition = null; w.player.setPose(s.standPos.x, s.standPos.z, s.standYaw, 0); w.actions.sit('table1a'); for (let i = 0; i < 30; i++) w.player.update(0.05); });
  await sleep(400);
  const chip = await page.evaluate(() => { const c = [...document.querySelectorAll('#hud-bottom .hud-chip')].find((x) => !x.classList.contains('hidden')); return c ? c.innerHTML : null; });
  check('seated: the chip says "Leertaste oder WASD Aufstehen"', chip === '<kbd>Leertaste</kbd> oder <kbd>WASD</kbd> Aufstehen', chip);
  await key('KeyQ', 'q');
  const afterQ = await page.evaluate(() => ({ seated: !!window.__app.world.player.seated, panels: document.querySelectorAll('.panel-layer:not(.closing)').length }));
  await key('Space', ' ');
  const afterSpace = await page.evaluate(() => { const w = window.__app.world; for (let i = 0; i < 30; i++) w.player.update(0.05); return { seated: !!w.player.seated, seatedId: w.actions.seatedId }; });
  check('Q does nothing while seated, Space stands up', afterQ.seated && afterQ.panels === 0 && !afterSpace.seated && afterSpace.seatedId === null, { afterQ, afterSpace });
  const standPose = await page.evaluate(() => { const w = window.__app.world; return { x: w.player.position.x, z: w.player.position.z, yaw: w.player.yaw, film: !globalThis.__cozyshelvesMediaPlayer.video.paused, filmLoaded: !!globalThis.__cozyshelvesMediaPlayer.current }; });
  // the key goes down and stays down a moment (the helper), then the jump is stepped through by hand
  await key('Space', ' ');
  const spaceJump = await page.evaluate(() => {
    const w = window.__app.world, p = w.player;
    const air = !!p.air; let top = 0;
    for (let i = 0; i < 90; i++) { p.update(1 / 60); top = Math.max(top, w.camera.position.y - p.position.y); }
    return { air, top: +top.toFixed(3), landed: !p.air, x: p.position.x, z: p.position.z, yaw: p.yaw, seated: !!p.seated, panels: document.querySelectorAll('.panel-layer:not(.closing)').length, film: !globalThis.__cozyshelvesMediaPlayer.video.paused, filmLoaded: !!globalThis.__cozyshelvesMediaPlayer.current };
  });
  check('Space while standing jumps and does not open panels or toggle media', spaceJump.air && spaceJump.top > 0.35 && spaceJump.landed && !spaceJump.seated && spaceJump.panels === 0 && spaceJump.film === standPose.film && spaceJump.filmLoaded === standPose.filmLoaded && Math.abs(spaceJump.x - standPose.x) < 1e-6 && Math.abs(spaceJump.z - standPose.z) < 1e-6, { standPose, spaceJump });

  // ---- clean up ------------------------------------------------------------------------------------------------------------------------
  await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.stop(); globalThis.__cozyshelvesPodcastPlayer.stop(); clearInterval(window.__testTimer); });
  await sleep(300);
  s = await state();
  check('after stopping both, the mini player is gone', !s.bar.visible && !s.active, s);
  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  console.log(`MEDIA-FOCUS-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
};
