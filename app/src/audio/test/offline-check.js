// Audio engine check for the dev harness:
//   node build/dev-shot.js records --interact=app/src/audio/test/offline-check.js
// 1) plays every record / ambient layer / sfx live in sequence (no exceptions allowed)
// 2) renders every record, ambient layer and sfx through an OfflineAudioContext and asserts:
//    non-silent, peak < 0.9, no NaN. Prints RMS / peak per item.
module.exports = async ({ page, shot }) => {
  const res = await page.evaluate(async () => {
    const audio = window.__ctx.audio;
    const out = { errors: [], stats: [], live: [] };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const orig = console.error; console.error = (...a) => { out.errors.push(a.map(String).join(' ')); orig(...a); };
    window.addEventListener('error', (e) => out.errors.push('window: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => out.errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
    try {
      audio.init({ autoplay: false }); audio.init(); // idempotent
      out.live.push('ctx ' + audio.ctx.state + ' sr=' + audio.ctx.sampleRate);
      for (const r of audio.records()) { audio.playRecord(r.id); await sleep(350); out.live.push('record ' + r.id + ' playing=' + audio.playing); }
      audio.ambient.set({ fire: true, rain: true });   // (no switches since 0.7: does nothing, must not fail)
      await sleep(300);
      for (const n of audio.sfxNames()) { audio.sfx(n); await sleep(40); }
      await sleep(200);
      audio.stopSfx('purr');
      audio.duck(true); await sleep(100); audio.duck(false);
      audio.setVolumes({ music: 0.5, ambient: 0.5, sfx: 0.5 });
      await audio.suspend(); await sleep(100); await audio.resume();
      audio.next(); audio.prev();
      audio.playRecord('nocturne');
      await sleep(1500);
      out.live.push('current=' + (audio.currentRecord && audio.currentRecord.id) + ' gens=' + audio.gens.size + ' state=' + audio.ctx.state);
      for (const r of audio.records()) if (!r.silent) out.stats.push(await audio.renderStats('record', r.id, 14));
      for (const a of ['fire', 'firebowl', 'rain', 'wind', 'clock', 'thunder', 'cricket']) out.stats.push(await audio.renderStats('ambient', a, 8));
      for (const v of ['blackbird', 'robin', 'greattit', 'chaffinch', 'chiffchaff', 'wren', 'pigeon', 'sparrow', 'crow', 'cuckoo', 'owl', 'frog', 'treefrog', 'duck', 'moorhen', 'lap']) out.stats.push(await audio.renderStats('voice', v, 6));
      for (const n of audio.sfxNames()) out.stats.push(await audio.renderStats('sfx', n, 4));
      out.state = JSON.parse(JSON.stringify(audio.state));
    } catch (e) { out.errors.push('thrown: ' + (e.stack || e)); }
    return out;
  });
  let bad = 0;
  for (const l of res.live) console.log('  [live]', l);
  for (const s of res.stats) {
    const problems = [];
    if (s.silent) problems.push('SILENT');
    if (s.peak >= 0.9) problems.push('CLIPPING');
    if (s.nan) problems.push('NaN=' + s.nan);
    if (problems.length) bad++;
    console.log(`  ${(s.kind + ':' + s.id).padEnd(24)} rms=${s.rms.toFixed(5)}  peak=${s.peak.toFixed(3)} ${problems.join(' ')}`);
  }
  for (const e of res.errors) console.log('  [ERROR]', e);
  console.log(`audio check: ${res.stats.length} renders, ${bad} problems, ${res.errors.length} errors`);
  if (bad || res.errors.length) process.exitCode = 1;
};
