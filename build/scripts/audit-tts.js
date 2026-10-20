// Audit: read-aloud. Voice download with progress and cancel in the settings, then reading from the newspaper,
// the encyclopedia and the reader. Everything is checked through state (button labels, session, AudioContext):
// build/screenshot.js runs Electron with --mute-audio. Uses the smallest German voice (Eva, 20 MB).
const kit = require('./audit-lib');
const VOICE = 'de_DE-eva_k-x_low';

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
  const status = () => page.evaluate(() => document.querySelector('.tts-status .tts-text')?.textContent || '');
  // the bundled TTS client is not importable from the page: its bus snapshots tell us what it does
  await page.evaluate(() => { window.__tts = null; window.__app.ctx.bus.on('tts:status', (s) => { window.__tts = { active: s.active, paused: s.paused, index: s.index, total: s.total, lang: s.lang, german: s.german, message: s.message }; }); });
  const ttsState = () => page.evaluate(() => window.__tts);

  // ---- settings: status line, pick Eva, download → cancel → download ------------------------------------------
  await k.open('settings', { section: 'tts' }, 2500);
  log('STATUS-1 ' + await status());
  await shot('t-settings-1');
  const pickVoice = async (v) => { await page.evaluate((x) => { const sel = document.querySelector('.settings-content select.input'); sel.value = x; sel.dispatchEvent(new Event('change')); }, v); await sleep(1500); };
  const btnText = () => page.evaluate(() => [...document.querySelectorAll('.settings-content .btn')].map((b) => b.textContent.trim()).filter((t) => /Herunterladen|Abbrechen|Download|Cancel/.test(t)).join('|'));
  // cancel: the 60 MB Thorsten voice, stopped after a second
  await pickVoice('de_DE-thorsten-medium');
  log('BUTTON-before ' + await btnText());
  await k.clickText('.settings-content .btn', 'Herunterladen', 1200);
  log('BUTTON-during ' + await btnText() + ' STATUS ' + await status());
  await shot('t-settings-downloading');
  await k.clickText('.settings-content .btn', 'Abbrechen', 1500);
  log('BUTTON-after-cancel ' + await btnText() + ' TOASTS ' + JSON.stringify(await toasts()) + ' STATUS ' + await status());
  await shot('t-settings-cancelled');
  // download: the 20 MB Eva voice to the end
  await pickVoice(VOICE);
  await k.clickText('.settings-content .btn', 'Herunterladen', 1000);
  for (let i = 0; i < 90; i++) {
    const done = await page.evaluate(async (v) => (await window.api.invoke('tts:piperVoices')).voices.find((x) => x.id === v)?.installed, VOICE);
    if (done) break;
    await sleep(2000);
  }
  await sleep(1500);
  log('BUTTON-after-download ' + await btnText() + ' TOASTS ' + JSON.stringify(await toasts()) + ' STATUS ' + await status());
  await shot('t-settings-installed');
  await k.closeAll();

  // ---- newspaper: read an article aloud, watch the button, stop it ----------------------------------------------
  const watch = async (sel, ms) => {
    const seen = [];
    for (let t = 0; t < ms; t += 500) {
      const s = await page.evaluate((q) => document.querySelector(q)?.textContent.trim() || null, sel);
      if (s && seen[seen.length - 1] !== s) seen.push(s);
      if (/beenden|Stop/.test(s || '')) break;
      await sleep(500);
    }
    return seen;
  };
  await k.open('news', { category: 'news' }, 6000);
  await page.evaluate(() => [...document.querySelectorAll('.news-item')].find((x) => /tagesschau|Deutsche|taz|Spiegel|Zeit/i.test(x.textContent))?.click() || document.querySelector('.news-item')?.click());
  await sleep(5000);
  await page.evaluate(() => document.querySelector('.news-art-toolbar .tts-btn')?.click());
  const newsStates = await watch('.news-art-toolbar .tts-btn', 40000);
  const audioState = await ttsState();
  log('NEWS-BUTTON ' + JSON.stringify(newsStates) + ' AUDIO ' + JSON.stringify(audioState));
  await shot('t-news-speaking');
  await page.evaluate(() => document.querySelector('.news-art-toolbar .tts-btn')?.click());
  await sleep(800);
  log('NEWS-STOPPED ' + JSON.stringify({ tts: await ttsState(), btn: await page.evaluate(() => document.querySelector('.news-art-toolbar .tts-btn')?.textContent.trim()) }));
  // start again and close the panel: the reading must stop with it
  await page.evaluate(() => document.querySelector('.news-art-toolbar .tts-btn')?.click());
  await sleep(2500);
  await k.closeAll();
  await sleep(600);
  log('NEWS-CLOSED ' + JSON.stringify(await ttsState()));

  // ---- encyclopedia --------------------------------------------------------------------------------------------
  await k.open('wiki', { title: 'Bibliothek' }, 7000);
  await page.evaluate(() => document.querySelector('.wiki-actions .tts-btn')?.click());
  const wikiStates = await watch('.wiki-actions .tts-btn', 30000);
  log('WIKI-BUTTON ' + JSON.stringify(wikiStates));
  await shot('t-wiki-speaking');
  await k.closeAll(); await sleep(500);
  log('WIKI-CLOSED ' + JSON.stringify(await ttsState()));

  // ---- reader: V starts, the bar shows sentences, pause/resume, stop ------------------------------------------
  const id = await page.evaluate(() => (window.__app.state.library.books.find((b) => b.format === 'epub') || {}).id);
  await k.open('reader', { id }, 6000);
  await page.keyboard.press('v');
  let bar = '';
  for (let i = 0; i < 60; i++) {
    bar = await page.evaluate(() => document.querySelector('.rd-ttsbar:not(.hidden)')?.innerText.replace(/\s+/g, ' ') || '');
    if (/Satz \d+/.test(bar)) break;
    await sleep(500);
  }
  log('READER-BAR ' + bar);
  await shot('t-reader-speaking');
  await page.keyboard.press('v'); await sleep(600);   // pause
  log('READER-PAUSED ' + JSON.stringify(await ttsState()));
  await page.keyboard.press('v'); await sleep(600);   // resume
  log('READER-RESUMED ' + JSON.stringify(await ttsState()));
  await page.keyboard.press('Escape'); await sleep(600);  // stops the reading first
  log('READER-ESC ' + JSON.stringify({ tts: await ttsState(), bar: await page.evaluate(() => !document.querySelector('.rd-ttsbar')?.classList.contains('hidden')) }));
  await k.closeAll();
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
