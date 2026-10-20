// Audit: English read-aloud (Kokoro in a worker). First run downloads the model; a later run (same userdata)
// must take it from the IndexedDB cache. Checked through the button labels and the TTS bus snapshots (muted).
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, shot, sleep, log } = k;
  await k.boot();
  await page.evaluate(() => { window.__tts = null; window.__app.ctx.bus.on('tts:status', (s) => { window.__tts = { active: s.active, index: s.index, lang: s.lang, english: s.english, message: s.message, dev: s.englishDetail?.device, dtype: s.englishDetail?.dtype }; }); });
  await k.open('wiki', { lang: 'en', title: 'Library' }, 8000);
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('.wiki-actions .tts-btn')?.click());
  const seen = [];
  for (let t = 0; t < 300000; t += 1000) {
    const s = await page.evaluate(() => document.querySelector('.wiki-actions .tts-btn')?.textContent.trim() || null);
    if (s && seen[seen.length - 1] !== s) seen.push(s);
    if (/beenden|Stop/.test(s || '')) break;
    await sleep(1000);
  }
  log('EN-BUTTON after ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + JSON.stringify(seen.slice(0, 6)) + ' … ' + JSON.stringify(seen.slice(-3)));
  log('EN-STATE ' + JSON.stringify(await page.evaluate(() => window.__tts)));
  await shot('te-wiki-en');
  await k.closeAll();
  const idb = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('lesesaal-kokoro'); r.onsuccess = () => { try { const tx = r.result.transaction('files'); const q = tx.objectStore('files').getAllKeys(); q.onsuccess = () => res(q.result.map(String)); } catch (e) { res('no store ' + e.message); } }; r.onerror = () => res('idb error'); }));
  log('IDB-KEYS ' + JSON.stringify(idb));
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 10)));
};
