// Audit: radio and podcasts. Recommendations with filters, a show with its episodes, subscribe, playback (checked
// through the player state: build/screenshot.js runs Electron with --mute-audio), saved position, skip, speed,
// the sleep timer with its fade, playback after the panel closes, search, OPML export and import (the file dialogs
// of the main process are replaced for this run), unsubscribe, and the layout at two window sizes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, app, shot, sleep, log } = k;
  await k.boot();
  const player = () => page.evaluate(() => { const p = globalThis.__cozyshelvesPodcastPlayer; if (!p) return null; const s = p.state; return { id: s.current?.episode.id || null, playing: s.playing, position: Math.round(s.position), duration: Math.round(s.duration), rate: s.rate, volume: s.volume, error: s.error, sleepUntil: !!s.sleepUntil, buffering: s.buffering, paused: p.audio.paused }; });
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).slice(-3));
  const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(400); } return false; };

  // AUDIT_PART=sizes: only the layout at the two window sizes
  if (process.env.AUDIT_PART !== 'sizes') {
  // ---- recommendations --------------------------------------------------------------------------------------------
  await k.open('podcasts', {}, 2500);
  await waitFor(async () => (await k.count('.pod-shows .pod-show')) > 10);
  log(`CURATED tab=${await k.text('.pod-tabs .tab.active')} shows=${await k.count('.pod-shows .pod-show')} sections=${await k.count('.pod-shows .pod-section-title')}`);
  await shot('pod-curated');
  await k.clickText('.pod-filters .pod-chip', 'DE', 300);
  log('FILTER-DE shows=' + await k.count('.pod-shows .pod-show'));
  await k.clickText('.pod-filters .pod-chip', 'Alle', 300);

  // ---- a show: episodes, subscribe ------------------------------------------------------------------------------------
  await k.clickText('.pod-shows .pod-show', 'Sternengeschichten', 300);
  await waitFor(async () => (await k.count('.pod-detail .pod-ep')) > 0, 30000);
  log(`SHOW ${await k.text('.pod-show-h')} episodes=${await k.count('.pod-detail .pod-ep')} err=${await k.text('.pod-err')}`);
  await k.clickText('.pod-show-head .btn', 'Abonnieren', 1500);
  log('SUBSCRIBED toasts=' + JSON.stringify(await toasts()) + ' subs=' + (await page.evaluate(async () => (await window.api.podcasts.subscriptions()).length)));
  // the description of an episode folds open; its links stay in the app
  await page.evaluate(() => document.querySelector('.pod-detail .pod-ep')?.click());
  await sleep(500);
  log('DESCRIPTION open=' + await k.exists('.pod-ep-desc') + ' links=' + await k.count('.pod-ep-desc a'));

  // ---- playback -----------------------------------------------------------------------------------------------------------
  await page.evaluate(() => document.querySelector('.pod-detail .pod-ep .pod-play')?.click());
  const started = await waitFor(async () => { const p = await player(); return p && p.playing && p.position >= 2; }, 45000);
  log('PLAY started=' + started + ' ' + JSON.stringify(await player()));
  await shot('pod-playing');
  await page.keyboard.press('ArrowRight'); await sleep(1200);   // +15 s
  log('SKIP+15 ' + JSON.stringify(await player()));
  await page.evaluate(() => document.querySelector('.pod-rate')?.click()); await sleep(300);
  log('RATE ' + JSON.stringify(await player()));
  await page.keyboard.press(' '); await sleep(1500);   // pause → the position is saved
  const p1 = await player();
  const saved = await page.evaluate(async (id) => (await window.api.podcasts.getPositions())[id] || null, p1.id);
  log('PAUSE ' + JSON.stringify(p1) + ' saved=' + JSON.stringify(saved));

  // sleep timer: 0.25 min, the last 10 s fade out, then pause and the volume comes back
  await page.keyboard.press(' ');
  await waitFor(async () => (await player()).playing, 15000);
  const volBefore = (await player()).volume;
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.setSleep(0.25));
  await sleep(9000);
  const mid = await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.audio.volume);
  await waitFor(async () => !(await player()).playing, 20000);
  log(`SLEEP volBefore=${volBefore} duringFade=${mid.toFixed(2)} after=${JSON.stringify(await player())}`);
  // a new timer while the fade runs: the old fade stops and the volume is restored (bug fixed in b694206)
  await page.keyboard.press(' ');
  await waitFor(async () => (await player()).playing, 15000);
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.setSleep(0.2));
  await sleep(6000);
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.setSleep(30));
  await sleep(600);
  log('SLEEP-RESET ' + JSON.stringify(await player()) + ' audioVolume=' + await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.audio.volume));
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.setSleep(null));

  // the panel closes, the podcast keeps playing; the panel opens again with the player bar
  await k.closeAll(); await sleep(1500);
  log('CLOSED-PANEL ' + JSON.stringify(await player()) + ' musicDucked=' + await page.evaluate(() => window.__app.ctx.audio?.ducked));
  await k.open('podcasts', {}, 2500);
  log('REOPENED bar=' + (await k.text('.pod-player-title')) + ' show=' + (await k.text('.pod-show-h')));
  await page.evaluate(() => [...document.querySelectorAll('.pod-player .btn')].find((b) => b.title === 'Stopp')?.click());
  await sleep(800);
  log('STOPPED ' + JSON.stringify(await player()) + ' idle=' + await k.exists('.pod-player.idle') + ' musicDucked=' + await page.evaluate(() => window.__app.ctx.audio?.ducked));

  // the chosen speed (1.2×) also holds for the next episode
  await k.clickText('.pod-shows .pod-show', 'Sternengeschichten', 300);
  await waitFor(async () => (await k.count('.pod-detail .pod-ep')) > 1, 30000);
  await page.evaluate(() => document.querySelectorAll('.pod-detail .pod-ep .pod-play')[1]?.click());
  await waitFor(async () => (await player()).playing, 30000);
  log('NEXT-EPISODE ' + JSON.stringify(await player()) + ' audioRate=' + await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.audio.playbackRate));
  await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.stop());

  // ---- search -------------------------------------------------------------------------------------------------------------
  await k.clickText('.pod-tabs .tab', 'Suche', 400);
  await page.evaluate(() => { const i = document.querySelector('.pod-search'); i.value = 'Geschichte'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await waitFor(async () => (await k.count('.pod-shows .pod-show')) > 0 || (await k.exists('.pod-empty p.muted')), 20000);
  log('SEARCH results=' + await k.count('.pod-shows .pod-show') + ' first=' + (await k.text('.pod-shows .pod-show-title')).slice(0, 60));

  // ---- OPML export and import -----------------------------------------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lesesaal-opml-'));
  const outFile = path.join(dir, 'export.opml');
  const inFile = path.join(dir, 'import.opml');
  fs.writeFileSync(inFile, '<?xml version="1.0"?><opml version="2.0"><body><outline text="Forschung aktuell" xmlUrl="https://www.deutschlandfunk.de/forschung-aktuell-102.xml"/><outline text="Sternengeschichten" xmlUrl="https://sternengeschichten.podigee.io/feed/mp3"/></body></opml>');
  await app.evaluate(({ dialog }, files) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.out });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.in] });
  }, { out: outFile, in: inFile });
  await k.clickText('.pod-header .btn', '⇧ OPML', 1200);
  const exported = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  log('OPML-EXPORT outlines=' + (exported.match(/<outline /g) || []).length + ' toasts=' + JSON.stringify(await toasts()));
  await k.clickText('.pod-header .btn', '⇩ OPML', 1500);
  log('OPML-IMPORT toasts=' + JSON.stringify(await toasts()) + ' subs=' + JSON.stringify(await page.evaluate(async () => (await window.api.podcasts.subscriptions()).map((s) => s.title))));

  // ---- unsubscribe everything again ---------------------------------------------------------------------------------
  for (const s of await page.evaluate(async () => (await window.api.podcasts.subscriptions()).map((x) => x.feedUrl))) await page.evaluate((u) => window.api.podcasts.unsubscribe(u), s);
  await k.closeAll();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  for (const [w, hh] of [[1024, 640], [2560, 1440]]) {
    await k.setSize(w, hh);
    await k.open('podcasts', { tab: 'curated' }, 2500);
    await k.clickText('.pod-shows .pod-show', 'Lage der Nation', 300);
    await waitFor(async () => (await k.count('.pod-detail .pod-ep')) > 0, 30000);
    await shot(`pod-${w}`);
    log(`SIZE ${w}x${hh} idle overflow=${JSON.stringify(await k.overflow())}`);
    // the player bar with all its controls must fit as well
    await page.evaluate(() => document.querySelector('.pod-detail .pod-ep .pod-play')?.click());
    await waitFor(async () => (await player()).playing, 30000);
    await sleep(800);
    await shot(`pod-${w}-playing`);
    const bar = await page.evaluate(() => { const b = document.querySelector('.pod-player'); const r = b.getBoundingClientRect(); return { w: Math.round(r.width), scroll: b.scrollWidth, h: Math.round(r.height), out: [...b.querySelectorAll('*')].filter((e) => { const x = e.getBoundingClientRect(); return x.width && (x.right > r.right + 1 || x.left < r.left - 1); }).map((e) => e.className).slice(0, 6) }; });
    log(`SIZE ${w}x${hh} playing bar=${JSON.stringify(bar)} overflow=${JSON.stringify(await k.overflow())}`);
    await page.evaluate(() => globalThis.__cozyshelvesPodcastPlayer.stop());
    await k.closeAll();
  }
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
