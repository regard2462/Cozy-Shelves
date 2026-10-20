// German read-aloud: phonemes, audio and timing of every installed German voice, checked through the real client and
// workers. Nothing is played audibly: render() synthesizes into a buffer, and the live part runs in the muted harness.
//   COZYSHELVES_PIPER_DIR=<copy of the voice files> node build/screenshot.js tts-de-check
// TTS_CHECK_VOICES=id,id limits the voices, TTS_CHECK_LIVE=<id> picks the voice of the live reading (default: the
// first installed light voice).
const fs = require('fs');
const path = require('path');

const SENTENCES = [
  'Guten Tag, das ist ein Test.',
  'Die Zeitung berichtete über die Bundesregierung.',
  'Am 3. Oktober 1990 wurde Deutschland wiedervereinigt.',
  'Das Buch kostet 24,95 € und hat 352 Seiten, vgl. z. B. Kapitel 4.',
  'Im 19. Jahrhundert wuchsen die Städte sehr schnell, und viele Menschen zogen vom Land in die Fabriken, wo sie unter schwierigen Bedingungen arbeiteten, während ihre Familien auf den Dörfern blieben und die Felder bestellten, so gut es eben ging.',
  'Wir trafen uns im Restaurant und bestellten Croissants.',
];
// espeak-ng phonemes (piper-phonemize 1.1.0) of the first two sentences, NFC for comparison
const GOLDEN = {
  0: 'ɡˈuːtən tˈɑːk, das ɪst aɪn tˈɛst.',
  1: 'diː tsˈaɪtˌʊŋ bərˈɪçtətə ˌyːbɜ diː bˈʊndəsreːɡˈiːrʊŋ.',
};

module.exports = async ({ page, sleep }) => {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const errors = [];
  page.on('pageerror', (e) => { if (!/pointer lock/i.test(e.message)) errors.push(e.message); });
  await page.waitForFunction(() => window.__app && window.api && window.__ttsClient, null, { timeout: 240000 });
  await sleep(1000);

  const voices = await page.evaluate(async () => (await window.api.invoke('tts:piperVoices')).voices.filter((v) => v.installed).map((v) => ({ id: v.id, engine: v.engine, gpu: !!v.gpu, sampleRate: v.sampleRate })));
  const only = (process.env.TTS_CHECK_VOICES || '').split(',').filter(Boolean);
  const list = voices.filter((v) => !only.length || only.includes(v.id));
  check('voices installed', list.length > 0, list.map((v) => v.id));
  const devices = {};
  // the workers report their device and phonemizer in the status messages
  await page.evaluate(() => { window.__ttsDev = []; window.__app.ctx.bus.on('tts:status', (s) => { const m = s?.piperDetail?.message || ''; if (/bereit/.test(m) && window.__ttsDev[window.__ttsDev.length - 1] !== m) window.__ttsDev.push(m); }); });

  for (const v of list) {
    const t0 = Date.now();
    const r = await page.evaluate(async ([voice, sentences]) => {
      try {
        const out = await window.__ttsClient.render(sentences, { lang: 'de', voice });
        let peak = 0, clipped = 0;
        for (const x of out.samples) { const a = Math.abs(x); if (a > peak) peak = a; if (a >= 0.999) clipped++; }
        // silences inside the sentences (dropouts) and between them, from 10 ms frames
        const size = Math.round(out.sampleRate * 0.01);
        const rms = [];
        for (let i = 0; i + size <= out.samples.length; i += size) { let s = 0; for (let k = i; k < i + size; k++) s += out.samples[k] * out.samples[k]; rms.push(Math.sqrt(s / size)); }
        let inside = 0;
        for (const m of out.marks) { let run = 0; for (let f = Math.floor(m.start * 100); f < Math.ceil(m.end * 100) && f < rms.length; f++) { if (rms[f] < 0.004) { run++; inside = Math.max(inside, run * 10); } else run = 0; } }
        const gaps = out.marks.slice(1).map((m, k) => Math.round((m.start - out.marks[k].end) * 1000));
        const dur = out.samples.length / out.sampleRate;
        return { ok: true, sampleRate: out.sampleRate, dur: +dur.toFixed(2), peak: +peak.toFixed(3), clipped, inside, gaps, marks: out.marks.length, synthMs: out.synthMs, pieces: out.pieces.map((p) => ({ i: p.index, k: p.piece, lead: p.lead, tail: p.tail, gain: p.gain, ph: p.phonemizer, phonemes: p.phonemes })) };
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    }, [v.id, SENTENCES]);
    if (!r.ok) { check(`${v.id}: render`, false, r.error); continue; }
    const wall = (Date.now() - t0) / 1000;
    const synth = r.synthMs.reduce((a, b) => a + b, 0) / 1000;
    devices[v.id] = await page.evaluate(() => window.__ttsDev.slice(-1)[0] || '');
    const rtf = +(synth / r.dur).toFixed(3);
    console.log(`INFO ${v.id}: ${r.dur} s audio, synthesis ${synth.toFixed(2)} s (RTF ${rtf}, first call incl. model load), ${devices[v.id]}`);
    check(`${v.id}: every sentence rendered`, r.marks === SENTENCES.length, r.marks);
    check(`${v.id}: sample rate of the voice`, r.sampleRate === v.sampleRate, r.sampleRate);
    check(`${v.id}: phonemes from espeak-ng`, r.pieces.every((p) => p.ph === 'espeak'), [...new Set(r.pieces.map((p) => p.ph))]);
    if (v.engine === 'piper') {
      for (const [i, want] of Object.entries(GOLDEN)) {
        const got = (r.pieces.find((p) => p.i === +i)?.phonemes || '').normalize('NFC');
        check(`${v.id}: phonemes of sentence ${i} equal piper-phonemize`, got === want, got);
      }
    }
    check(`${v.id}: no clipping`, r.clipped === 0 && r.peak <= 0.96, { peak: r.peak, clipped: r.clipped });
    check(`${v.id}: equal pauses between sentences (320 ms)`, r.gaps.every((g) => Math.abs(g - 320) <= 2), r.gaps);
    check(`${v.id}: no dropout inside a sentence`, r.inside < 900, r.inside + ' ms');
    check(`${v.id}: silence of the voice trimmed`, r.pieces.every((p) => p.lead >= 0 && p.tail >= 0), r.pieces.map((p) => [p.lead, p.tail]));
    if (v.gpu) check(`${v.id}: heavy voice runs on WebGPU`, /webgpu/.test(devices[v.id]), devices[v.id]);
    else check(`${v.id}: light voice runs on the CPU`, /wasm/.test(devices[v.id]), devices[v.id]);
    // the second render of the same voice shows the speed once the model is loaded
    const t1 = Date.now();
    const again = await page.evaluate(async ([voice, sentences]) => { const o = await window.__ttsClient.render(sentences, { lang: 'de', voice }); return { dur: o.samples.length / o.sampleRate, synthMs: o.synthMs }; }, [v.id, SENTENCES.slice(1, 5)]);
    const rtf2 = +(again.synthMs.reduce((a, b) => a + b, 0) / 1000 / again.dur).toFixed(3);
    console.log(`INFO ${v.id}: warm RTF ${rtf2} (${again.dur.toFixed(1)} s audio in ${((Date.now() - t1) / 1000).toFixed(1)} s)`);
    check(`${v.id}: faster than real time once loaded`, rtf2 < 0.6, rtf2);
    await page.evaluate(() => window.__ttsClient.dispose());
    await sleep(500);
  }

  // ---- a live reading (muted): first audio, no late sentence, every sentence announced, onEnd --------------------
  const light = list.find((v) => !v.gpu);
  const liveIds = [process.env.TTS_CHECK_LIVE || (light && light.id), ...list.filter((v) => v.gpu).map((v) => v.id)].filter(Boolean);
  for (const id of [...new Set(liveIds)]) {
    const live = await page.evaluate(async ([voice, sentences]) => {
      const seen = [];
      const t0 = performance.now();
      const res = await new Promise((resolve) => {
        const s = window.__ttsClient.speak(sentences, { lang: 'de', voice, onSentence: (i) => seen.push([i, Math.round(performance.now() - t0)]), onEnd: () => resolve('end'), onError: (e) => resolve('error ' + e.message) });
        setTimeout(() => { s.stop(); resolve('timeout'); }, 240000);
      });
      const tl = window.__ttsClient.timeline;
      return { res, seen, firstAudioMs: tl?.firstAudioMs, entries: tl?.entries || [] };
    }, [id, SENTENCES]);
    const late = live.entries.slice(1).filter((e) => e.late > 0.02 || e.pieceLate > 0.02);
    console.log(`INFO live ${id}: first audio after ${live.firstAudioMs} ms (cold start), sentences ${JSON.stringify(live.seen)}`);
    check(`live ${id}: reading ends normally`, live.res === 'end', live.res);
    check(`live ${id}: every sentence announced in order`, live.seen.map((x) => x[0]).join() === SENTENCES.map((_, i) => i).join(), live.seen.map((x) => x[0]));
    check(`live ${id}: no sentence late after the first (no gap)`, late.length === 0, late);
    check(`live ${id}: pause between sentences 320 ms on the timeline`, live.entries.slice(1).every((e, k) => e.late > 0.02 || Math.abs(e.start - live.entries[k].end - 0.32) < 0.005), live.entries.map((e) => [e.index, e.start, e.end, e.late]));
    // warm: the same voice again, the first audio now only waits for one short piece
    const warm = await page.evaluate(async ([voice, sentences]) => {
      await new Promise((resolve) => { window.__ttsClient.speak(sentences, { lang: 'de', voice, onEnd: resolve, onError: resolve }); setTimeout(resolve, 60000); });
      return window.__ttsClient.timeline?.firstAudioMs;
    }, [id, SENTENCES.slice(4, 5)]);
    console.log(`INFO live ${id}: first audio of a warm voice with the long sentence: ${warm} ms`);
    // the heavy voices share the graphics card with whatever else runs on it: a little more time for them
    const limit = list.find((v) => v.id === id)?.gpu ? 3000 : 2000;
    check(`live ${id}: warm first audio within ${limit / 1000} s`, warm != null && warm < limit, warm);
    // pause and resume, a skip forward by two and one back: the announced sentences follow the controls
    const ctl = await page.evaluate(async ([voice, sentences]) => {
      const seen = [];
      let s = null, paused = false, ahead = false, back = false;
      const res = await new Promise((resolve) => {
        s = window.__ttsClient.speak(sentences, {
          lang: 'de', voice,
          onSentence: (i) => {
            seen.push(i);
            if (i === 1 && !paused) { paused = true; s.pause(); setTimeout(() => s.resume(), 800); }
            if (i === 2 && !ahead) { ahead = true; setTimeout(() => s.skip(2), 300); }
            if (i === 4 && !back) { back = true; setTimeout(() => s.skip(-1), 300); }
          },
          onEnd: () => resolve('end'), onError: (e) => resolve('error ' + e.message),
        });
        setTimeout(() => { s.stop(); resolve('timeout'); }, 180000);
      });
      return { res, seen };
    }, [id, SENTENCES]);
    check(`live ${id}: pause, resume, skip +2 and -1`, ctl.res === 'end' && ctl.seen.join() === '0,1,2,4,3,4,5', ctl);
    await page.evaluate(() => window.__ttsClient.dispose());
  }

  // ---- English (Kokoro) through the same timeline, when TTS_CHECK_EN=1 (the model must be in this userdata) -----
  if (process.env.TTS_CHECK_EN) {
    const EN = ['Good evening, this is a test.', 'The library opens at nine o\'clock in the morning.', 'She read the whole book in one night, and in the morning she started again from the first page.', 'Thank you!'];
    const en = await page.evaluate(async (sentences) => {
      const seen = [];
      const res = await new Promise((resolve) => {
        const s = window.__ttsClient.speak(sentences, { lang: 'en', onSentence: (i) => seen.push(i), onEnd: () => resolve('end'), onError: (e) => resolve('error ' + e.message) });
        setTimeout(() => { s.stop(); resolve('timeout'); }, 300000);
      });
      const tl = window.__ttsClient.timeline;
      return { res, seen, firstAudioMs: tl?.firstAudioMs, entries: tl?.entries || [] };
    }, EN);
    console.log(`INFO live English: first audio after ${en.firstAudioMs} ms, timeline ${JSON.stringify(en.entries.map((e) => [e.index, e.start, e.end, e.late, e.engine]))}`);
    check('live English: reading ends normally, every sentence announced', en.res === 'end' && en.seen.join() === EN.map((_, i) => i).join(), en);
    check('live English: spoken by Kokoro', en.entries.length === EN.length && en.entries.every((e) => e.engine === 'kokoro'), en.entries);
    // the English worker itself is unchanged: on wasm (q8) it is slower than real time on a busy machine, on WebGPU not
    const late = en.entries.slice(1).filter((e) => e.late > 0.02 || e.pieceLate > 0.02).length;
    console.log(`INFO live English: ${late} of ${en.entries.length - 1} sentences after the first came late (English device from the settings)`);
  }
  check('no page errors', errors.length === 0, errors.slice(0, 5));
  const passed = results.filter((r) => r.ok).length;
  console.log(`tts-de-check: ${passed}/${results.length} passed`);
  if (process.env.TTS_CHECK_OUT) fs.writeFileSync(path.join(process.env.TTS_CHECK_OUT, 'tts-de-check.json'), JSON.stringify({ results, devices }, null, 1));
};
