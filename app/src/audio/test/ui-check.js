// UI check for the record player panel:
//   node build/dev-shot.js records --interact=app/src/audio/test/ui-check.js
module.exports = async ({ page, shot }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.click('.rec-sleeve[data-id="regentag"]');
  await sleep(600);
  let st = await page.evaluate(async () => ({ rec: window.__ctx.audio.currentRecord?.id, playing: window.__ctx.audio.playing, saved: (await window.__ctx.api.settings.get()).audio.record }));
  console.log('  after sleeve click:', JSON.stringify(st));
  if (st.rec !== 'regentag' || !st.playing || st.saved !== 'regentag') { console.log('  FAIL sleeve click'); process.exitCode = 1; }
  // no switches for the sounds of the world any more (0.7: they follow the world); the music slider
  st = await page.evaluate(() => ({ toggles: document.querySelectorAll('.rec-toggle-row, .rec-panel .toggle').length, labels: [...document.querySelectorAll('.rec-vol-label')].map((e) => e.textContent) }));
  console.log('  sound switches:', JSON.stringify(st));
  if (st.toggles !== 0 || st.labels.length !== 2) { console.log('  FAIL the panel still has sound switches'); process.exitCode = 1; }
  await page.evaluate(() => { const r = document.querySelector('.rec-range'); r.value = 30; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(500);
  st = await page.evaluate(async () => { const a = (await window.__ctx.api.settings.get()).audio; return { music: a.music, vol: window.__ctx.audio.state.volumes.music }; });
  console.log('  after slider:', JSON.stringify(st));
  if (Math.abs(st.music - 0.3) > 0.001 || Math.abs(st.vol - 0.3) > 0.001) { console.log('  FAIL slider'); process.exitCode = 1; }
  // stop via play button, then space to restart
  await page.click('.rec-play');
  await sleep(300);
  st = await page.evaluate(() => ({ playing: window.__ctx.audio.playing, spinning: !!document.querySelector('.rec-platter.spinning') }));
  console.log('  after stop:', JSON.stringify(st));
  if (st.playing || st.spinning) { console.log('  FAIL stop'); process.exitCode = 1; }
  await page.keyboard.press('Space');
  await sleep(300);
  st = await page.evaluate(() => ({ playing: window.__ctx.audio.playing, rec: window.__ctx.audio.currentRecord?.id, spinning: !!document.querySelector('.rec-platter.spinning') }));
  console.log('  after space:', JSON.stringify(st));
  if (!st.playing || !st.spinning) { console.log('  FAIL space'); process.exitCode = 1; }
  // stille + bus event from outside (world) switches the record
  await page.evaluate(() => window.__ctx.bus.emit('music:record', 'winterlicht'));
  await sleep(300);
  st = await page.evaluate(() => ({ rec: window.__ctx.audio.currentRecord?.id, badge: document.querySelector('.rec-sleeve.playing')?.dataset.id }));
  console.log('  after bus event:', JSON.stringify(st));
  if (st.rec !== 'winterlicht' || st.badge !== 'winterlicht') { console.log('  FAIL bus event'); process.exitCode = 1; }
  // fake user music folder through the mock api
  await page.evaluate(async () => {
    const api = window.__ctx.api;
    api.files.pickFolder = async () => 'C:/Musik/Abendlieder';
    api.files.list = async (folder) => folder ? [{ path: folder + '/02 Abendlied.mp3', name: '02 Abendlied.mp3', url: 'data:audio/mp3;base64,' }, { path: folder + '/01 Morgenrot.ogg', name: '01 Morgenrot.ogg', url: 'data:audio/ogg;base64,' }] : [];
  });
  await page.click('.rec-own .btn.small');
  await sleep(700);
  st = await page.evaluate(async () => ({ tracks: window.__ctx.audio.state.userTracks.map((t) => t.title), folder: (await window.__ctx.api.settings.get()).audio.musicFolder, rows: document.querySelectorAll('.rec-track').length }));
  console.log('  after folder:', JSON.stringify(st));
  if (st.rows !== 2 || st.folder !== 'C:/Musik/Abendlieder') { console.log('  FAIL folder'); process.exitCode = 1; }
  await page.click('.rec-track:nth-child(1)');
  await sleep(600);
  st = await page.evaluate(() => ({ rec: window.__ctx.audio.currentRecord?.id, proc: window.__ctx.audio.currentRecord?.procedural }));
  console.log('  after track click:', JSON.stringify(st));
  await page.evaluate(() => window.__ctx.i18n.setLanguage('en'));
  await sleep(400);
  await shot('dev-records-en');
  await page.evaluate(() => window.__ctx.i18n.setLanguage('de'));
  await page.evaluate(() => window.__ctx.audio.playRecord('kaminjazz'));
  await sleep(500);
  for (const e of errors) console.log('  [pageerror]', e);
  if (errors.length) process.exitCode = 1;
  console.log('ui check done, errors:', errors.length);
};
