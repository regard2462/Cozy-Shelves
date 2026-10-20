// Audit: German read-aloud on a fresh start. The caller seeds <userData>/settings.json with the settings of an
// older build (tts.germanVoice 'default', the Kartoffelbox era); after the start the voice is the default voice
// (Martin since 0.6, the catalogue names it as defaultVoice). Before the
// first download of that voice the read-aloud button of the encyclopedia and the reader ask, the reader then shows
// the download progress and reads. A second read-aloud starts without the question.
// Checked through state and bar texts only (build/screenshot.js runs Electron with --mute-audio).
// AUDIT_NO_DOWNLOAD=1 stops after the questions, AUDIT_OFFLINE=1 checks the message when the download fails.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  const tts = await page.evaluate(async () => (await window.__app.ctx.api.settings.get()).tts);
  log('SETTINGS ' + JSON.stringify(tts));
  const DEFAULT = await page.evaluate(async () => (await window.api.invoke('tts:piperVoices')).defaultVoice);
  log('DEFAULT-VOICE ' + DEFAULT + ' settings=' + tts.germanVoice + ' ' + (tts.germanVoice === DEFAULT ? 'ok' : 'MISMATCH'));
  const installed = () => page.evaluate(async (v) => !!(await window.api.invoke('tts:piperVoices')).voices.find((x) => x.id === v)?.installed, DEFAULT);
  log('INSTALLED-BEFORE ' + await installed());

  // ---- encyclopedia: the button asks first ------------------------------------------------------------------
  await k.open('wiki', { title: 'Bibliothek' }, 7000);
  await page.evaluate(() => document.querySelector('.wiki-actions .tts-btn')?.click());
  await sleep(1500);
  log('WIKI-BUTTON ' + JSON.stringify(await page.evaluate(() => { const b = document.querySelector('.wiki-actions .tts-btn'); return b ? { text: b.textContent.trim(), title: b.title, offer: b.classList.contains('offer') } : null; })));
  await shot('td-wiki-offer');
  await k.closeAll();

  // ---- reader: V asks, "Herunterladen und vorlesen" downloads with progress and reads -----------------------------
  const id = await page.evaluate(() => (window.__app.state.library.books.find((b) => b.format === 'epub') || {}).id);
  const barText = () => page.evaluate(() => document.querySelector('.rd-ttsbar:not(.hidden)')?.innerText.replace(/\s+/g, ' ').trim() || '');
  await k.open('reader', { id }, 6000);
  await page.keyboard.press('v');
  let bar = '';
  for (let i = 0; i < 30; i++) { bar = await barText(); if (/heruntergeladen|Satz \d+/.test(bar)) break; await sleep(500); }
  log('READER-OFFER ' + bar + ' | offer=' + await page.evaluate(() => !!document.querySelector('.rd-ttsbar.offer')));
  await shot('td-reader-offer');
  if (process.env.AUDIT_NO_DOWNLOAD) { await k.closeAll(); log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1)); return; }

  await k.clickText('.rd-ttsbar .btn', 'Herunterladen und vorlesen', 200);
  // AUDIT_OFFLINE=1 (with COZYSHELVES_PIPER_BASE pointing at a closed port): the reader names the reason
  if (process.env.AUDIT_OFFLINE) {
    let notice = '';
    for (let i = 0; i < 60 && !notice; i++) { notice = await page.evaluate(() => { const n = document.querySelector('.rd-notice:not(.hidden)'); return n ? n.textContent : ''; }); if (!notice) await sleep(500); }
    log('OFFLINE notice=' + notice + ' | bar visible=' + await page.evaluate(() => !!document.querySelector('.rd-ttsbar:not(.hidden)')));
    await shot('td-reader-offline');
    await k.closeAll();
    log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
    return;
  }
  const seen = [];
  for (let i = 0; i < 360; i++) {
    bar = await barText();
    const st = await page.evaluate(() => document.querySelector('.rd-tts-status-text')?.textContent || '');
    if (st && seen[seen.length - 1] !== st) seen.push(st);
    if (/Satz \d+/.test(bar)) break;
    if (i === 6) await shot('td-reader-downloading');
    await sleep(500);
  }
  log('PROGRESS ' + seen.length + ' texts: ' + JSON.stringify(seen.slice(0, 4)) + ' … ' + JSON.stringify(seen.slice(-2)));
  log('READER-READING ' + bar);
  log('INSTALLED-AFTER ' + await installed());
  await shot('td-reader-reading');
  await page.keyboard.press('Escape'); await sleep(600);
  await k.closeAll();

  // ---- the second time there is no question -----------------------------------------------------------------
  await k.open('reader', { id }, 5000);
  await page.keyboard.press('v');
  for (let i = 0; i < 40; i++) { bar = await barText(); if (/Satz \d+|heruntergeladen/.test(bar)) break; await sleep(500); }
  log('READER-SECOND ' + bar + ' | offer=' + await page.evaluate(() => !!document.querySelector('.rd-ttsbar.offer')));
  await page.keyboard.press('Escape'); await sleep(600);
  await k.closeAll();
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 20), null, 1));
};
