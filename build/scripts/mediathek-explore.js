// Focused look at one part of the Mediathek while developing it (not part of the checks).
// Currently: the HLS paths (live TV, SRF on demand, ORF with geo blocking).
module.exports = async ({ page, sleep }) => {
  const log = (...a) => console.log(...a);
  page.on('pageerror', (e) => { if (!/pointer lock/.test(e.message)) log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (/hls|worker|\[media\]/i.test(m.text())) log('CONSOLE', m.type(), m.text().slice(0, 240)); });
  await page.waitForFunction(() => window.__app && document.querySelector('.menu-btn.primary'), null, { timeout: 240000 });
  await page.evaluate(() => { window.__app.world.stop(); document.querySelector('.menu-btn.primary').click(); });
  await sleep(1500);
  const st = () => page.evaluate(async () => { const p = globalThis.__cozyshelvesMediaPlayer; const v = p.video; const s = await window.api.invoke('mediathek:stats'); return { t: +v.currentTime.toFixed(1), rs: v.readyState, paused: v.paused, src: (v.currentSrc || '').slice(0, 30), hls: !!p.hls, worker: !!(p.hls && p.hls.config.enableWorker), q: p.state.quality, qs: p.state.qualities.map((x) => x.id), live: p.state.live, err: p.state.error, kind: p.state.errorKind, subs: p.state.hasSubtitles, w: v.videoWidth, playlists: s.playlists, proxy: s.proxy }; });
  const cors = () => page.evaluate(() => { const v = globalThis.__cozyshelvesMediaPlayer.video; try { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.drawImage(v, 0, 0, 8, 8); g.getImageData(0, 0, 1, 1); return 'ok'; } catch (e) { return e.name; } });
  const run = async (label, fn, n = 10) => {
    await page.evaluate(fn);
    for (let i = 0; i < n; i++) { await sleep(2000); const s = await st(); log(label, JSON.stringify(s)); if (s.t > 3 || s.err) break; }
    log(label, 'CORS', await cors());
  };
  if (process.env.MT_ONLY === 'ui') {
    const shotp = async (n) => { await sleep(400); await page.screenshot({ path: require('path').join(process.env.SHOT_DIR || '.', n + '.png') }); log('shot', n); };
    const item = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { topic: 'tagesschau', channels: ['ARD'], durationMin: 600, size: 3 })).items[0]);
    await page.evaluate((it) => window.__app.ctx.openPanel('mediathek', { open: it }), item);
    await sleep(3500); await shotp('ui-detail');
    await page.click('.mt-act-watch');
    await page.waitForFunction(() => globalThis.__cozyshelvesMediaPlayer.video.currentTime > 2, null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setSubtitles(true); globalThis.__cozyshelvesMediaPlayer.seek(62); });
    await sleep(4000);
    const box = await page.locator('.mt-detail .mt-stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
    await shotp('ui-playing-subs');
    await page.keyboard.press('f'); await sleep(800);
    await page.mouse.move(400, 400); await page.mouse.move(420, 410);
    await shotp('ui-fullscreen-subs');
    await page.keyboard.press('Escape'); await sleep(300);
    await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setSubtitles(false); globalThis.__cozyshelvesMediaPlayer.stop(); window.__app.closeAllPanels(); });
    await page.evaluate(() => window.__app.ctx.openPanel('mediathek', { section: 'live' }));
    await page.waitForSelector('.mt-live-card', { timeout: 30000 }); await sleep(3000);
    await page.click('.mt-live-card[data-live="das_erste"]');
    await page.waitForFunction(() => globalThis.__cozyshelvesMediaPlayer.video.currentTime > 1, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500); await shotp('ui-live-detail');
    await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.stop(); window.__app.closeAllPanels(); });
    await page.evaluate(() => window.__app.ctx.openPanel('mediathek', { section: 'channels' }));
    await sleep(1500); await shotp('ui-channels');
    await page.click('.mt-chan[title="Norddeutscher Rundfunk"]');
    await sleep(6000); await shotp('ui-channel-ndr');
    await page.click('.mt-tabs .tab:nth-child(2)');
    await sleep(4000); await shotp('ui-channel-az');
    await page.evaluate(() => window.__app.closeAllPanels());
    return;
  }
  if (process.env.MT_ONLY === 'orf') {
    const orf = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['ORF'], size: 5 })).items[0]);
    await run('ORF', `globalThis.__cozyshelvesMediaPlayer.play(${JSON.stringify(orf)}, { mode: 'panel' }).catch(() => {})`, 8);
    log('ORF diagnose', JSON.stringify(await page.evaluate((u) => window.api.invoke('mediathek:diagnose', u), orf.video.sd)));
    return;
  }
  const live = await page.evaluate(async () => (await window.api.invoke('mediathek:live')).find((c) => c.id === 'zdf'));
  await run('LIVE', `(() => { window.__app.ctx.openPanel('mediathek', {}); return globalThis.__cozyshelvesMediaPlayer.play({ id: 'live:zdf', title: 'ZDF', channel: 'ZDF', live: true, hls: true, src: ${JSON.stringify(live.stream)} }, { mode: 'panel' }).catch(() => {}); })()`);
  await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setSubtitles(true); });
  await sleep(4000);
  log('LIVE subs', JSON.stringify(await page.evaluate(() => { const p = globalThis.__cozyshelvesMediaPlayer; return { has: p.state.hasSubtitles, track: p.hls?.subtitleTrack, tracks: [...p.video.textTracks].map((t) => t.kind + ':' + t.mode + ':' + (t.cues?.length || 0)) }; })));
  await page.evaluate(() => { globalThis.__cozyshelvesMediaPlayer.setSubtitles(false); globalThis.__cozyshelvesMediaPlayer.stop(); });
  const srf = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['SRF'], durationMin: 60, sort: 'short', size: 10 })).items.find((x) => x.hls));
  await run('SRF', `globalThis.__cozyshelvesMediaPlayer.play(${JSON.stringify(srf)}, { mode: 'panel' }).catch(() => {})`);
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
  const orf = await page.evaluate(async () => (await window.api.invoke('mediathek:query', { channels: ['ORF'], size: 5 })).items[0]);
  await run('ORF', `globalThis.__cozyshelvesMediaPlayer.play(${JSON.stringify(orf)}, { mode: 'panel' }).catch(() => {})`, 8);
  await page.evaluate(() => globalThis.__cozyshelvesMediaPlayer.stop());
};
