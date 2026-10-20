// Audit: record player, basket, book card and settings (with the appearance Hell, Sepia, Dunkel: shown at once,
// stored in settings.json, the window background follows). Everything is checked through state: the audio engine
// (playing, record, volumes, ambient flags; build/screenshot.js runs Electron with --mute-audio), the world
// (shadows, bloom, field of view, mouse sensitivity), the stored settings and settings.json on disk.
// The folder dialog of the main process is replaced for this run (own music folder with one generated WAV).
const fs = require('fs');
const path = require('path');
const kit = require('./audit-lib');

/** 1 s of a quiet 440 Hz tone as 16-bit mono WAV */
function wav() {
  const rate = 22050, n = rate, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 2000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

module.exports = async (env) => {
  const k = kit(env);
  const { page, app, shot, sleep, log } = k;
  await k.boot();
  const audio = () => page.evaluate(() => { const a = window.__app.ctx.audio; const s = a.state || {}; return { playing: !!s.playing, record: s.record?.id || null, volumes: s.volumes, ambient: s.ambient, folder: s.musicFolder, tracks: (s.userTracks || []).length, ctx: a.ctx?.state }; });
  const settings = () => page.evaluate(async () => window.api.settings.get());
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).slice(-3));

  // ---- record player ---------------------------------------------------------------------------------------------
  await k.open('records', {}, 2500);
  log('RECORDS sleeves=' + await k.count('.rec-sleeve') + ' state=' + JSON.stringify(await audio()));
  const first = await page.evaluate(() => [...document.querySelectorAll('.rec-sleeve')].find((s) => !s.classList.contains('silent'))?.dataset.id);
  await page.evaluate((id) => document.querySelector(`.rec-sleeve[data-id="${id}"]`)?.click(), first);
  await sleep(2500);
  log('PLAY ' + first + ' ' + JSON.stringify(await audio()) + ' spinning=' + await k.exists('.rec-platter.spinning'));
  await shot('misc-records-playing');
  // music volume slider → engine and settings
  await page.evaluate(() => { const r = document.querySelectorAll('.rec-range')[0]; r.value = '30'; r.dispatchEvent(new Event('input')); });
  await sleep(900);
  log('VOLUME engine=' + JSON.stringify((await audio()).volumes) + ' stored=' + (await settings()).audio?.music);
  // ambient toggle "Standuhr"
  const clockBefore = (await audio()).ambient?.clock;
  await page.evaluate(() => [...document.querySelectorAll('.rec-toggle-row')].find((r) => /Standuhr|clock/i.test(r.textContent))?.click());
  await sleep(700);
  log(`AMBIENT clock ${clockBefore} → ${(await audio()).ambient?.clock} stored=${(await settings()).audio?.clock}`);
  await page.evaluate(() => [...document.querySelectorAll('.rec-toggle-row')].find((r) => /Standuhr|clock/i.test(r.textContent))?.click());
  await sleep(400);
  // the rain at the window follows the weather (clear here), also after a change of another setting
  log('RAIN-IN-CLEAR-WEATHER engine=' + (await audio()).ambient?.rain + ' weather=' + (await settings()).weather);
  // stop with space
  await page.keyboard.press(' '); await sleep(1200);
  log('STOP ' + JSON.stringify(await audio()) + ' stored record=' + (await settings()).audio?.record);
  // own music folder with one WAV
  const dir = path.join(path.dirname(process.env.COZYSHELVES_USERDATA || require('os').tmpdir()), 'music-test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Testton A.wav'), wav());
  await app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] }); }, dir);
  await k.clickText('.rec-panel .btn', 'Ordner wählen', 2500);
  log('FOLDER toasts=' + JSON.stringify(await toasts()) + ' tracks=' + await k.count('.rec-track') + ' ' + JSON.stringify(await audio()));
  await page.evaluate(() => document.querySelector('.rec-track')?.click());
  await sleep(1500);
  log('TRACK ' + JSON.stringify(await audio()) + ' time=' + await k.text('.rec-now-time'));
  await shot('misc-records-own');
  await page.keyboard.press(' '); await sleep(600);
  await page.evaluate(() => document.querySelector('.rec-folder-row .btn.ghost')?.click()); await sleep(800);
  log('FOLDER-REMOVED ' + JSON.stringify(await audio()) + ' stored=' + (await settings()).audio?.musicFolder);
  await k.closeAll();

  // two sources duck the music at once (podcast and read-aloud): it comes back only when both are done
  const duck = await page.evaluate(() => { const a = window.__app.ctx.audio; const r = []; a.duck(true, 'podcast'); a.duck(true, 'tts'); r.push(a.ducked); a.duck(false, 'tts'); r.push(a.ducked); a.duck(false, 'podcast'); r.push(a.ducked); return r; });
  log('DUCK both=' + duck[0] + ' afterTts=' + duck[1] + ' afterPodcast=' + duck[2]);

  // ---- basket and book card ------------------------------------------------------------------------------------------
  const ids = await page.evaluate(() => window.__app.state.library.books.slice(0, 3).map((b) => b.id));
  await page.evaluate((list) => { for (const id of list) window.__app.ctx.bus.emit('book:borrow', { id }); }, ids);
  await sleep(1200);
  await k.open('basket', {}, 1500);
  log('BASKET items=' + await k.count('.basket-item') + ' borrowed=' + JSON.stringify(await page.evaluate(async (list) => Promise.all(list.map(async (id) => (await window.api.library.book(id))?.borrowed)), ids)));
  await shot('misc-basket');
  await k.clickText('.basket-item .btn', 'Zurück', 800);
  log('BASKET-RETURN-ONE items=' + await k.count('.basket-item'));
  await k.clickText('.basket-panel .btn', 'Alle', 800);
  log('BASKET-RETURN-ALL items=' + await k.count('.basket-item') + ' empty=' + (await k.text('.basket-panel .panel-body')).slice(0, 60));
  await k.closeAll();

  await k.open('bookinfo', { id: ids[0] }, 1500);
  log('BOOKINFO ' + (await k.text('.rd-bi-main')).slice(0, 160));
  await shot('misc-bookinfo');
  await k.clickText('.rd-bi-actions .btn', 'In den Korb', 800);
  log('BOOKINFO-BORROW button=' + (await k.text('.rd-bi-actions')).slice(0, 80) + ' stored=' + await page.evaluate(async (id) => (await window.api.library.book(id))?.borrowed, ids[0]));
  await k.clickText('.rd-bi-actions .btn', 'Zurück ins Regal', 800);
  const deptBefore = await page.evaluate(async (id) => { const b = await window.api.library.book(id); return [b.department, b.shelf]; }, ids[0]);
  await k.clickText('.rd-bi-actions .btn', 'Abteilung ändern', 400);
  const target = await page.evaluate((cur) => { const sel = document.querySelector('.rd-bi-dept select'); const o = [...sel.options].find((x) => x.value !== cur); if (!o) return null; sel.value = o.value; sel.dispatchEvent(new Event('change')); return o.value; }, deptBefore[0]);
  await k.clickText('.rd-bi-dept .btn', 'Übernehmen', 1500);
  const deptAfter = await page.evaluate(async (id) => { const b = await window.api.library.book(id); return [b.department, b.shelf, b.departmentSource]; }, ids[0]);
  log(`BOOKINFO-DEPT ${JSON.stringify(deptBefore)} → ${target} → ${JSON.stringify(deptAfter)} toasts=${JSON.stringify(await toasts())}`);
  await page.evaluate(async ([id, d, s]) => window.api.library.setDepartment(id, d, s), [ids[0], deptBefore[0], deptBefore[1]]);
  // the card follows a switch to English while it is open
  await page.evaluate(() => window.api.settings.set({ language: 'en' })); await sleep(900);
  log('BOOKINFO-EN ' + (await k.text('.rd-bi-actions')).slice(0, 80));
  await page.evaluate(() => window.api.settings.set({ language: 'de' })); await sleep(700);
  await k.closeAll();

  // ---- settings: every control is stored and applied ----------------------------------------------------------------
  const world = () => page.evaluate(() => { const w = window.__app.world; return { shadows: w.renderer.shadowMap.enabled, bloom: w.bloom?.enabled, fov: w.player.fov, sens: w.player.sensitivity, quality: w.quality }; });
  const clickSeg = (label, value) => page.evaluate(([l, v]) => { const row = [...document.querySelectorAll('.settings-content .setting')].find((r) => r.querySelector('label')?.textContent.includes(l)); const b = row && [...row.querySelectorAll('.seg button')].find((x) => x.textContent.trim() === v); b?.click(); return !!b; }, [label, value]);
  const flip = (label) => page.evaluate((l) => { const row = [...document.querySelectorAll('.settings-content .setting')].find((r) => r.querySelector('label')?.textContent.includes(l)); const t = row?.querySelector('.toggle'); t?.click(); return t ? t.classList.contains('on') : null; }, label);
  const slide = (label, v) => page.evaluate(([l, val]) => { const row = [...document.querySelectorAll('.settings-content .setting')].find((r) => r.querySelector('label')?.textContent.includes(l)); const i = row?.querySelector('input.range'); if (!i) return false; i.value = String(val); i.dispatchEvent(new Event('input')); return true; }, [label, v]);

  await k.open('settings', { section: 'general' }, 1500);
  await clickSeg('Sprache', 'English'); await sleep(900);
  log('LANG en: tabs=' + (await k.text('.settings-panel [role="tablist"]')).slice(0, 80) + ' stored=' + (await settings()).language);
  await clickSeg('Language', 'Deutsch'); await sleep(900);
  log('LANG de: tabs=' + (await k.text('.settings-panel [role="tablist"]')).slice(0, 80));
  log('HINTS ' + await flip('Hinweise') + ' stored=' + (await settings()).hints + ' | CAT ' + await flip('Bibliothekskatze') + ' stored=' + (await settings()).cat);
  await flip('Hinweise'); await flip('Bibliothekskatze'); await sleep(400);
  // appearance: the three previews; the last one (Dunkel) stays for the rest of the run and for the file on disk
  log('APPEARANCE start ' + JSON.stringify({ html: await page.evaluate(() => document.documentElement.dataset.theme), stored: (await settings()).ui?.theme }));
  for (const t of ['light', 'sepia', 'dark']) {
    await page.evaluate((th) => document.querySelector(`.settings-content .theme-opt[data-theme="${th}"]`)?.click(), t);
    await sleep(900);
    const r = await page.evaluate(async () => ({
      html: document.documentElement.dataset.theme,
      stored: (await window.api.settings.get()).ui?.theme,
      checked: document.querySelector('.settings-content .theme-opt[aria-checked="true"]')?.dataset.theme,
      panel: getComputedStyle(document.querySelector('.settings-panel')).backgroundColor,
      text: getComputedStyle(document.querySelector('.settings-content .setting label')).color,
      mirror: localStorage.getItem('lesesaal.theme'),
    }));
    r.window = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getBackgroundColor()).join(','));
    log(`APPEARANCE ${t} ${JSON.stringify(r)}`);
    await shot('misc-settings-theme-' + t);
  }

  await k.clickText('.settings-panel [role="tab"]', 'Grafik', 700);
  const w0 = await world();
  await clickSeg('Qualität', 'niedrig'); await sleep(900);
  const w1 = await world();
  await clickSeg('Qualität', 'hoch'); await sleep(900);
  const shadowsOn = await flip('Schatten'); await sleep(900);
  const w2 = await world();
  await flip('Schatten'); await sleep(600);
  await slide('Blickfeld', 85); await slide('Mausempfindlichkeit', 1.6); await sleep(1200);
  const w3 = await world();
  log(`GRAPHICS start=${JSON.stringify(w0)} low=${JSON.stringify(w1)} shadowsToggle=${shadowsOn} → ${JSON.stringify(w2)} fov/sens=${JSON.stringify(w3)} stored=${JSON.stringify((await settings()).graphics)}`);
  await slide('Blickfeld', 72); await slide('Mausempfindlichkeit', 1); await sleep(800);

  await k.clickText('.settings-panel [role="tab"]', 'Licht', 700);
  await clickSeg('Wetter', 'Regen'); await sleep(800);
  const rain = await audio();
  await clickSeg('Tageszeit', 'Feste Uhrzeit'); await sleep(800);
  const hourRow = await slide('Uhrzeit', 8); await sleep(600);
  log(`LIGHT weather=${(await settings()).weather} rainAmbient=${rain.ambient?.rain} timeMode=${(await settings()).timeMode} hourSlider=${hourRow} fixedHour=${(await settings()).fixedHour}`);
  await shot('misc-settings-light');
  await clickSeg('Wetter', 'Klar'); await clickSeg('Tageszeit', 'Echte Uhrzeit'); await sleep(800);

  await k.clickText('.settings-panel [role="tab"]', 'Klang', 700);
  await slide('Musik', 0.2); await slide('Effekte', 0.3); await sleep(900);
  const fireOn = await flip('Kaminknistern'); await sleep(700);
  log(`SOUND engine=${JSON.stringify((await audio()).volumes)} fire=${fireOn} engineFire=${(await audio()).ambient?.fire} stored=${JSON.stringify((await settings()).audio)}`);
  await flip('Kaminknistern'); await slide('Musik', 0.45); await slide('Effekte', 0.7); await sleep(900);

  await k.clickText('.settings-panel [role="tab"]', 'Vorlesen', 1500);
  await slide('Sprechtempo', 1.2); await sleep(900);
  log('TTS speed stored=' + (await settings()).tts?.speed);
  await slide('Sprechtempo', 1); await sleep(700);
  await k.closeAll();

  // on disk (the store writes at the latest 2.5 s after a change)
  await sleep(3000);
  const file = path.join(process.env.COZYSHELVES_USERDATA || '', 'settings.json');
  let disk = null;
  try { disk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { disk = { error: e.message }; }
  log('DISK ui.theme=' + disk.ui?.theme + ' language=' + disk.language + ' weather=' + disk.weather + ' timeMode=' + disk.timeMode + ' fixedHour=' + disk.fixedHour + ' audio.music=' + disk.audio?.music + ' tts.speed=' + disk.tts?.speed + ' graphics=' + JSON.stringify(disk.graphics));

  for (const [w, hh] of [[1024, 640], [2560, 1440]]) {
    await k.setSize(w, hh);
    for (const [name, params] of [['records', {}], ['bookinfo', { id: ids[0] }], ['settings', { section: 'tts' }]]) {
      await k.open(name, params, 2000);
      await shot(`misc-${w}-${name}`);
      log(`SIZE ${w}x${hh} ${name} overflow=${JSON.stringify(await k.overflow())}`);
      await k.closeAll();
    }
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
