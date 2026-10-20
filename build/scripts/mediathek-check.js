// Mediathek end to end, with real network data (MediathekViewWeb, the broadcasters' CDNs, live streams):
//   search "Tagesschau" → detail → play in the panel until currentTime > 2 → CORS check (2D canvas and
//   WebGL texture) → subtitles → quality switch → 'audio' (HUD mini player) → 'screen' + cinema:watch →
//   stop; a live channel (HLS); an arte film; an SRF film (HLS on demand); a geo-blocked ORF film;
//   downloads (short MP4 in low quality and a short HLS film) played offline; small and large windows.
// Runs muted (build/screenshot.js starts Electron with --mute-audio): playback is checked with currentTime.
// Usage: node build/screenshot.js mediathek-check   (COZYSHELVES_BOOKS / COZYSHELVES_USERDATA / SHOT_DIR as usual)
// Downloads go to MT_DOWNLOAD_DIR (default: "mt-downloads" next to COZYSHELVES_USERDATA), never into the real
// Videos folder of the user.
const path = require('path');
const os = require('os');
module.exports = async ({ app, page, shot, sleep }) => {
  const downloadDir = process.env.MT_DOWNLOAD_DIR || path.join(path.dirname(process.env.COZYSHELVES_USERDATA || path.join(os.tmpdir(), 'x')), 'mt-downloads');
  const results = [];
  const log = (...a) => console.log(...a);
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  const mp = (expr) => page.evaluate(`(() => { const p = globalThis.__cozyshelvesMediaPlayer; return ${expr}; })()`);
  const waitPlaying = async (min = 2, timeout = 60000) => {
    try { await page.waitForFunction((m) => { const p = globalThis.__cozyshelvesMediaPlayer; return p && p.current && p.video.currentTime > m && !p.video.paused; }, min, { timeout }); return true; }
    catch { return false; }
  };
  const state = () => mp('({ mode: p.mode, t: +p.video.currentTime.toFixed(2), paused: p.video.paused, src: (p.video.currentSrc || "").slice(0, 60), error: p.state.error, errorKind: p.state.errorKind, quality: p.state.quality, qualities: p.state.qualities.map((q) => q.id), live: p.state.live, subs: p.state.hasSubtitles, w: p.video.videoWidth, h: p.video.videoHeight, hls: !!p.hls })');
  const corsCheck = () => page.evaluate(() => {
    const v = globalThis.__cozyshelvesMediaPlayer.video;
    const out = { w: v.videoWidth, h: v.videoHeight };
    try {
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const g = c.getContext('2d'); g.drawImage(v, 0, 0, 64, 36);
      out.pixel = [...g.getImageData(32, 18, 1, 1).data];
      out.canvas = 'ok';
    } catch (e) { out.canvas = e.name + ': ' + e.message; }
    try {
      const gc = document.createElement('canvas'); const gl = gc.getContext('webgl');
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      out.webgl = gl.getError() === 0 ? 'ok' : 'glError ' + gl.getError();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (e) { out.webgl = e.name + ': ' + e.message; }
    return out;
  });
  const openPanel = async (params = {}) => {
    await page.evaluate((p) => window.__app.ctx.openPanel('mediathek', p), params);
    await page.waitForSelector('.mt-panel', { timeout: 30000 });
    await sleep(600);
  };
  const nav = async (label) => { await page.click(`.mt-navitem[title="${label}"]`); await sleep(500); };
  const stats = () => page.evaluate(() => window.api.invoke('mediathek:stats'));
  const waitDownload = async (itemId, timeout = 240000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const d = (await page.evaluate(() => window.api.invoke('mediathek:downloads'))).find((x) => x.item.id === itemId);
      if (d && (d.status === 'done' || d.status === 'error')) return d;
      await sleep(1500);
    }
    return (await page.evaluate(() => window.api.invoke('mediathek:downloads'))).find((x) => x.item.id === itemId);
  };

  // ---- start -------------------------------------------------------------------------------------------
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await page.evaluate((dir) => window.api.settings.set({ mediathek: { folder: dir } }), downloadDir);
  await sleep(1500);
  await openPanel();
  await page.waitForSelector('.mt-start .mt-card:not(.mt-skel)', { timeout: 60000 });
  await sleep(5000);
  const start = await page.evaluate(() => ({ rows: document.querySelectorAll('.mt-row').length, cards: document.querySelectorAll('.mt-card:not(.mt-skel)').length, pictures: document.querySelectorAll('.mt-img.loaded').length }));
  check('start page: rows with cards and preview images', start.rows >= 10 && start.cards >= 20 && start.pictures >= 4, start);
  await shot('mt-01-start');

  // ---- search "Tagesschau" -------------------------------------------------------------------------------
  await nav('Suche');
  await page.fill('.mt-search-input', 'Tagesschau');
  await page.press('.mt-search-input', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.mt-search .mt-grid .mt-card:not(.mt-skel)').length > 5, null, { timeout: 30000 });
  await sleep(2500);
  const found = await page.evaluate(() => [...document.querySelectorAll('.mt-search .mt-grid .mt-card-title')].slice(0, 5).map((e) => e.textContent));
  check('search "Tagesschau" finds tagesschau programmes', found.some((t) => /tagesschau/i.test(t)), found);
  await shot('mt-02-search');
  // the full tagesschau (not "in 100 Sekunden") keeps the first test short but real: the two-minute clip has no
  // subtitles and, that short, never lands in "Weiterschauen" (the last 90 s count as watched, films under three
  // minutes are not kept at all, and some daytime editions are that short): an edition of ten minutes or more
  const pick = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.mt-search .mt-grid .mt-card:not(.mt-skel)')];
    const full = (c) => !/100 Sekunden/i.test(c.querySelector('.mt-card-title')?.textContent || '');
    const long = cards.findIndex((c) => full(c) && parseInt(c.querySelector('.mt-dur')?.textContent || '0', 10) >= 10 && /Min/.test(c.querySelector('.mt-dur')?.textContent || ''));
    return long >= 0 ? long : Math.max(0, cards.findIndex(full));
  });
  await page.locator('.mt-search .mt-grid .mt-card:not(.mt-skel)').nth(pick).click();
  await page.waitForSelector('.mt-detail:not(.hidden)', { timeout: 10000 });
  await sleep(2500);
  const detailInfo = await page.evaluate(() => ({ title: document.querySelector('.mt-detail-title')?.textContent, actions: [...document.querySelectorAll('.mt-actions .btn span')].map((s) => s.textContent) }));
  check('detail view shows title and all actions', ['Ansehen', 'Auf der Leinwand zeigen', 'Anhören', 'Herunterladen', 'Merken', 'Webseite öffnen'].every((a) => detailInfo.actions.includes(a)), detailInfo);
  await shot('mt-03-detail');

  // Merkliste: the film goes onto the watchlist and back off again later
  await page.click('.mt-act-fav');
  await page.waitForFunction(() => document.querySelector('.mt-act-fav')?.classList.contains('on'), null, { timeout: 10000 }).catch(() => {});
  const favs = await page.evaluate(() => window.api.invoke('mediathek:favorites'));
  // the newest tagesschau item is not always called "tagesschau …" (e.g. "Mittagsausgabe"): compare with the opened film
  check('"Merken" puts the film on the watchlist', favs.some((f) => f.title === detailInfo.title), favs.map((f) => f.title));

  // ---- play in the panel ---------------------------------------------------------------------------------
  await page.click('.mt-act-watch');
  const playing = await waitPlaying(2, 60000);
  let st = await state();
  check('film plays in the panel (currentTime > 2)', playing && st.mode === 'panel', st);
  // MP4 plays from media://proxy/…; an HLS film plays from a blob: (hls.js), its playlists come through the proxy
  const proxyStats = await page.evaluate(() => window.api.invoke('mediathek:stats'));
  check('film comes through the media:// proxy', st.hls ? proxyStats.playlists > 0 && /^blob:/.test(st.src) : /^media:\/\/proxy\//.test(st.src), { src: st.src, hls: st.hls, playlists: proxyStats.playlists });
  await sleep(1500);
  await shot('mt-04-playing');
  let cors = await corsCheck();
  check('CORS: canvas getImageData and WebGL texture from the video', cors.canvas === 'ok' && cors.webgl === 'ok', cors);
  // controls visible after a mouse move over the stage
  const box = await page.locator('.mt-detail .mt-stage').boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
  await shot('mt-05-controls');

  // subtitles
  if (st.subs) {
    await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.setSubtitles(true));
    await page.waitForFunction(() => { const t = [...globalThis.__cozyshelvesMediaPlayer.video.textTracks].find((x) => x.mode !== 'disabled'); return t && t.cues && t.cues.length > 5; }, null, { timeout: 20000 }).catch(() => {});
    const subs = await page.evaluate(() => { const t = [...globalThis.__cozyshelvesMediaPlayer.video.textTracks].find((x) => x.mode !== 'disabled'); return t ? { mode: t.mode, cues: t.cues?.length || 0, first: t.cues?.[0]?.text?.slice(0, 60) } : null; });
    check('subtitles: TTML converted to WebVTT and shown', subs && subs.cues > 5 && subs.mode === 'showing', subs);
    await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.seek(62));
    await sleep(3500);
    await shot('mt-06-subtitles');
  } else check('subtitles: this film has subtitles', false, 'none offered');

  // quality switch keeps the position
  const before = (await state()).t;
  await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setQuality('low'); });
  await page.waitForFunction((b) => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'low' && p.video.currentTime > b - 3 && !p.video.paused; }, before, { timeout: 40000 }).catch(() => {});
  st = await state();
  check('quality switch to "Niedrig" keeps the position', st.quality === 'low' && st.t >= before - 3, { before, after: st.t, quality: st.quality, w: st.w });

  // keys: Space pauses, L jumps +10 s, F fullscreen, Escape leaves fullscreen first
  await page.keyboard.press('Space'); await sleep(500);
  const paused = await mp('p.video.paused');
  await page.keyboard.press('Space'); await sleep(800);
  const t0 = (await state()).t;
  await page.keyboard.press('l'); await sleep(900);
  const t1 = (await state()).t;
  await page.keyboard.press('f'); await sleep(700);
  const full = await page.evaluate(() => document.querySelector('.mt-panel').classList.contains('stage-full'));
  await shot('mt-07-fullscreen');
  await page.keyboard.press('Escape'); await sleep(500);
  const fullAfter = await page.evaluate(() => ({ full: document.querySelector('.mt-panel').classList.contains('stage-full'), detail: !document.querySelector('.mt-detail').classList.contains('hidden') }));
  check('keys: Space pauses, L +10 s, F fullscreen, Escape leaves fullscreen first', paused && t1 - t0 > 7 && full && !fullAfter.full && fullAfter.detail, { paused, t0, t1, full, fullAfter });

  // back to the list: the film keeps running in the dock
  await page.keyboard.press('Escape'); await sleep(900);
  const dock = await page.evaluate(() => ({ dock: !document.querySelector('.mt-dock').classList.contains('hidden'), inDock: !!document.querySelector('.mt-dock video'), playing: !globalThis.__cozyshelvesMediaPlayer.video.paused }));
  check('closing the detail keeps the film in the dock', dock.dock && dock.inDock && dock.playing, dock);
  await shot('mt-08-dock');

  // ---- audio mode: close the panel, the HUD mini player takes over ------------------------------------------
  // back to "Standard" first, so that the switch to the small quality in audio mode can be seen
  await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setQuality('sd'); });
  await page.waitForFunction(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.quality === 'sd' && !p.video.paused && p.video.readyState >= 3; }, null, { timeout: 40000 }).catch(() => {});
  await page.evaluate(() => window.__app.closeAllPanels());
  await sleep(1200);
  st = await state();
  const bar = await page.evaluate(() => { const b = document.querySelector('#media-bar'); const r = b.getBoundingClientRect(); return { visible: !b.classList.contains('hidden'), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), text: b.innerText.replace(/\s+/g, ' ').slice(0, 120) }; });
  check('closing the panel during playback continues as audio with the mini player', st.mode === 'audio' && !st.paused && bar.visible, { mode: st.mode, bar });
  await sleep(5000);
  st = await state();
  check('audio mode switches to the low quality', st.quality === 'low', st.quality);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__app.world.frame(); });
  await shot('mt-09-audio-bar');

  // ---- screen mode + cinema:watch -------------------------------------------------------------------------------
  await openPanel({ show: 'player' });
  await sleep(1500);
  const shown = await page.evaluate(() => ({ detail: !document.querySelector('.mt-detail').classList.contains('hidden'), inStage: !!document.querySelector('.mt-detail .mt-stage video') }));
  check('"Im Fenster" shows the running film in the panel again', shown.detail && shown.inStage && (await mp('p.mode')) === 'panel', shown);
  await page.waitForFunction(() => globalThis.__cozyshelvesMediaPlayer.state.quality === 'sd', null, { timeout: 30000 }).catch(() => {});
  check('back in the panel the film returns to the chosen quality', (await mp('p.state.quality')) === 'sd', await mp('p.state.quality'));
  const closedBy = page.evaluate(() => new Promise((res) => { const off = window.__app.ctx.bus.on('cinema:watch', () => { off(); res(true); }); setTimeout(() => res(false), 8000); }));
  await page.click('.mt-act-screen');
  const watched = await closedBy;
  await sleep(2500);
  st = await state();
  const panelsOpen = await page.evaluate(() => document.querySelectorAll('.panel-layer.open').length);
  check('"Auf der Leinwand zeigen": mode screen, cinema:watch, panels closed', watched && st.mode === 'screen' && !st.paused && panelsOpen === 0, { watched, mode: st.mode, panelsOpen });
  cors = await corsCheck();
  check('CORS on the screen as well', cors.canvas === 'ok' && cors.webgl === 'ok', cors);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__app.world.frame(); });
  await shot('mt-10-screen');
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  await sleep(600);
  st = await state();
  check('stop ends the film', !st.mode && !(await mp('p.current')), st);

  // ---- Merkliste and Weiterschauen ----------------------------------------------------------------------------------
  await openPanel({ section: 'favorites' });
  await page.waitForSelector('.mt-favs .mt-card', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  await shot('mt-10b-merkliste');
  const favCards = await page.evaluate(() => document.querySelectorAll('.mt-favs .mt-card').length);
  await nav('Weiterschauen');
  await page.waitForSelector('.mt-continue .mt-card', { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  await shot('mt-10c-weiterschauen');
  const cont = await page.evaluate(() => ({ cards: document.querySelectorAll('.mt-continue .mt-card').length, bars: document.querySelectorAll('.mt-continue .mt-prog').length }));
  check('Merkliste and Weiterschauen list the film (with a progress bar)', favCards >= 1 && cont.cards >= 1 && cont.bars >= 1, { favCards, cont });
  await page.evaluate(async () => { for (const f of await window.api.invoke('mediathek:favorites')) await window.api.invoke('mediathek:setFavorite', f, false); });
  await page.evaluate(() => window.__app.closeAllPanels());

  // ---- live TV (HLS) -------------------------------------------------------------------------------------------------
  await openPanel({ section: 'live' });
  await page.waitForSelector('.mt-live-card', { timeout: 30000 });
  await sleep(4000);
  await shot('mt-11-live');
  const liveNames = await page.evaluate(() => [...document.querySelectorAll('.mt-live-card .mt-type-text')].map((e) => e.textContent));
  check('live TV lists the channels', liveNames.length >= 25 && liveNames.includes('Das Erste') && liveNames.includes('arte'), liveNames.length);
  // ZDF first; its CDN (like arte's and 3sat's) refuses some connections with 403, then Das Erste
  let livePlaying = false, liveId = null;
  for (const id of ['zdf', 'das_erste']) {
    liveId = id;
    await page.click(`.mt-live-card[data-live="${id}"]`);
    await page.waitForFunction(() => { const p = globalThis.__cozyshelvesMediaPlayer; return p.state.error || (p.video.currentTime > 2 && !p.video.paused); }, null, { timeout: 60000 }).catch(() => {});
    livePlaying = await waitPlaying(2, 1000);
    if (livePlaying) break;
    await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.stop(); document.querySelector('.mt-detail .mt-back')?.click(); });
    await sleep(800);
  }
  st = await state();
  check(`live channel (${liveId}, HLS) plays through the proxy`, livePlaying && st.live && st.hls && /^blob:/.test(st.src), st);
  cors = await corsCheck();
  check('CORS with hls.js (live)', cors.canvas === 'ok' && cors.webgl === 'ok', cors);
  await sleep(1500);
  await shot('mt-12-live-playing');
  // 0.7: the levels of the master are its picture sizes ("1080p" … , see app/src/media/quality.js)
  const liveSizes = await mp('p.state.qualities.filter((q) => q.id !== "auto").map((q) => q.label)');
  check('live stream offers Automatisch and its picture sizes', st.qualities[0] === 'auto' && liveSizes.length >= 2 && liveSizes.every((l) => /^\d+p$/.test(l)), { ids: st.qualities, sizes: liveSizes });
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());

  // ---- an arte film ---------------------------------------------------------------------------------------------------
  const arte = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['ARTE.DE'], durationMin: 1800, size: 10 })).items[0]);
  await page.evaluate((it) => window.__app.ctx.openPanel('mediathek', { play: it }), arte);
  const artePlaying = await waitPlaying(2, 60000);
  st = await state();
  check('arte film plays', artePlaying && /^media:\/\/proxy\//.test(st.src), { title: arte?.title, st });
  await sleep(1500);
  await shot('mt-13-arte');
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());

  // ---- SRF (HLS on demand) and ORF (geo-blocked outside Austria) ------------------------------------------------------
  const srf = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['SRF'], durationMin: 60, sort: 'short', size: 10 })).items.find((x) => x.hls));
  if (srf) {
    await page.evaluate((it) => window.__app.ctx.openPanel('mediathek', { play: it }), srf);
    const ok = await waitPlaying(1.5, 60000);
    st = await state();
    check('SRF film (HLS on demand) plays', ok && st.hls, { title: srf.title, st });
    await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  } else check('SRF film (HLS on demand) found', false);
  const orf = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['ORF'], size: 5 })).items[0]);
  if (orf) {
    await page.evaluate((it) => window.__app.ctx.openPanel('mediathek', { play: it }), orf);
    await page.waitForFunction(() => globalThis.__cozyshelvesMediaPlayer.state.error || globalThis.__cozyshelvesMediaPlayer.video.currentTime > 2, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
    st = await state();
    check('ORF film: clear message when it is geo-blocked (or it plays)', (st.errorKind && /geo/.test(st.errorKind) && /Österreich|Geoblocking/.test(st.error)) || st.t > 2, st);
    await shot('mt-14-geo');
    await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  }

  // ---- downloads ---------------------------------------------------------------------------------------------------------
  // the first short film whose file still exists: the index keeps listing a programme for a while after the
  // broadcaster removed it (the app then says "nicht mehr verfügbar", which is right, but tests nothing)
  const candidates = await page.evaluate(async () => [
    ...(await window.api.invoke('mediathek:query', { topic: 'tagesschau in 100 Sekunden', channels: ['ARD'], size: 8 })).items,
    ...(await window.api.invoke('mediathek:query', { channels: ['DW'], durationMax: 240, size: 10 })).items,
  ].filter((x) => x.video?.low));
  let short = null;
  for (const c of candidates) {
    try { const r = await fetch(c.video.low, { method: 'HEAD' }); if (r.ok) { short = c; break; } } catch {}
  }
  short = short || candidates[0];
  await page.evaluate(() => window.__app.closeAllPanels());
  await openPanel({ open: short });
  await page.waitForSelector('.mt-detail:not(.hidden)', { timeout: 10000 });
  await sleep(1200);
  await page.click('.mt-act-dl');
  await page.waitForFunction(() => [...document.querySelectorAll('.mt-dlq-size')].some((e) => /MB|kB|GB/.test(e.textContent)), null, { timeout: 20000 }).catch(() => {});
  await sleep(400);
  await shot('mt-15-download-menu');
  const sizesShown = await page.evaluate(() => [...document.querySelectorAll('.mt-dlq-item')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  check('download menu lists the qualities with sizes', sizesShown.length >= 2 && sizesShown.some((s) => /MB/.test(s)), sizesShown);
  // the menu lists the sizes biggest first (0.7): the last one is the smallest file
  await page.click('.mt-dlq-item >> nth=-1');
  await sleep(1500);
  await shot('mt-15b-download-running');
  const mp4 = await waitDownload(short.id, 180000);
  check('MP4 download (low quality) finished in the chosen folder', mp4 && mp4.status === 'done' && mp4.bytes > 100000 && mp4.file.startsWith(downloadDir), mp4 && { status: mp4.status, bytes: mp4.bytes, file: mp4.file, error: mp4.error });
  await nav('Downloads');
  await sleep(1500);
  await shot('mt-16-downloads');
  if (mp4 && mp4.status === 'done') {
    await page.click(`.mt-dl.done .btn.primary`);
    const ok = await waitPlaying(2, 30000);
    st = await state();
    check('downloaded MP4 plays offline through lfile://', ok && /^lfile:\/\//.test(st.src), st);
    cors = await corsCheck();
    check('CORS with the downloaded file', cors.canvas === 'ok' && cors.webgl === 'ok', cors);
    await shot('mt-17-offline');
    await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  }
  // a short HLS film (SRF) as download: one .ts file with a byte-range playlist, played offline by hls.js
  if (srf) {
    await page.evaluate((it) => window.api.invoke('mediathek:download', it, 'low'), srf);
    const hlsDl = await waitDownload(srf.id, 240000);
    check('HLS download (SRF) finished as one file', hlsDl && hlsDl.status === 'done' && /\.ts$/.test(hlsDl.file), hlsDl && { status: hlsDl.status, file: hlsDl.file, bytes: hlsDl.bytes, error: hlsDl.error });
    if (hlsDl && hlsDl.status === 'done') {
      const before = await stats();
      const p = await page.evaluate((id) => window.api.invoke('mediathek:playable', id), hlsDl.id);
      await page.evaluate(({ d, p }) => { performance.clearResourceTimings(); globalThis.__cozyshelvesMediaPlayer.play({ ...d.item, ...p, local: true }, { mode: 'audio' }); }, { d: hlsDl, p });
      const ok = await waitPlaying(1.5, 30000);
      const after = await stats();
      const res = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name.split('/').slice(0, 3).join('/')).filter((n) => /^(media|lfile|https?):/.test(n)));
      st = await state();
      check('downloaded HLS film plays offline (media://local + lfile://, no proxy request)', ok && after.proxy === before.proxy && after.playlists === before.playlists && after.local > before.local, { st, proxy: [before.proxy, after.proxy], local: [before.local, after.local], hosts: [...new Set(res)] });
      await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
    }
  }

  // ---- window sizes ---------------------------------------------------------------------------------------------------------
  const setSize = (w, h, zoom = 1) => app.evaluate(({ BrowserWindow }, [w, h, zoom]) => { const win = BrowserWindow.getAllWindows().find((x) => /index\.html/.test(x.webContents.getURL())); win.setSize(w, h); win.webContents.setZoomFactor(zoom); }, [w, h, zoom]);
  await page.evaluate(() => window.__app.closeAllPanels());
  await setSize(1024, 640);
  await sleep(800);
  await openPanel();
  await sleep(6000);
  await shot('mt-18-small-start');
  await page.click('.mt-start .mt-card:not(.mt-skel)');
  await sleep(2500);
  await shot('mt-19-small-detail');
  await page.evaluate(() => window.__app.closeAllPanels());
  await setSize(1280, 720, 0.5);        // a 2560 × 1440 layout, drawn at half size
  await sleep(800);
  await openPanel();
  await sleep(7000);
  await shot('mt-20-large-start');
  await page.click('.mt-start .mt-card:not(.mt-skel)');
  await sleep(3000);
  await shot('mt-21-large-detail');
  await setSize(1600, 900, 1);

  check('no uncaught errors in the renderer', errors.length === 0, errors.slice(0, 5));
  const failed = results.filter((r) => !r.ok);
  log(`MEDIATHEK-CHECK ${results.length - failed.length}/${results.length} passed` + (failed.length ? ' · failed: ' + failed.map((f) => f.name).join(' | ') : ''));
  log('STATS ' + JSON.stringify(await stats()));
};
