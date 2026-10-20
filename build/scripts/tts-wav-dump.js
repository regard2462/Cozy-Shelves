// Renders test sentences with every installed German voice into WAV files (nothing is played), e.g. for a speech
// recognizer as an intelligibility measure.  WAV_DIR=<folder> WAV_CORPUS=<json list of sentences>
//   COZYSHELVES_PIPER_DIR=<copy of the voice files> node build/screenshot.js tts-wav-dump
// WAV_SPEED sets the speed (0.5 to 2), WAV_VOICES=id,id limits the voices. One folder per voice with NNN.wav (16-bit PCM, the voice's sample rate, 0.5 s of silence before and after) and
// refs.json (the sentences).
const fs = require('fs');
const path = require('path');

module.exports = async ({ page, sleep }) => {
  const out = process.env.WAV_DIR;
  if (!out) throw new Error('WAV_DIR is not set');
  const corpus = JSON.parse(fs.readFileSync(process.env.WAV_CORPUS, 'utf8')).slice(0, Number(process.env.WAV_COUNT) || 40);
  await page.waitForFunction(() => window.__app && window.api && window.__ttsClient, null, { timeout: 240000 });
  await sleep(1000);
  if (process.env.WAV_SPEED) await page.evaluate((x) => { window.__wavSpeed = x; }, Number(process.env.WAV_SPEED));
  const voices = await page.evaluate(async () => (await window.api.invoke('tts:piperVoices')).voices.filter((v) => v.installed).map((v) => v.id));
  const only = (process.env.WAV_VOICES || '').split(',').filter(Boolean);
  for (const id of voices.filter((v) => !only.length || only.includes(v))) {
    const dir = path.join(out, id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [k, text] of corpus.entries()) {
      const w = await page.evaluate(async ([voice, t]) => {
        const r = await window.__ttsClient.render([t], { lang: 'de', voice, speed: window.__wavSpeed || undefined });
        const pad = Math.round(r.sampleRate * 0.5);
        const pcm = new Int16Array(r.samples.length + 2 * pad);
        for (let i = 0; i < r.samples.length; i++) pcm[pad + i] = Math.max(-32768, Math.min(32767, Math.round(r.samples[i] * 32767)));
        const u8 = new Uint8Array(pcm.buffer);
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return { rate: r.sampleRate, b64: btoa(bin) };
      }, [id, text]);
      const pcm = Buffer.from(w.b64, 'base64');
      const h = Buffer.alloc(44);
      h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
      h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(w.rate, 24); h.writeUInt32LE(w.rate * 2, 28); h.writeUInt16LE(2, 32);
      h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
      fs.writeFileSync(path.join(dir, String(k).padStart(3, '0') + '.wav'), Buffer.concat([h, pcm]));
    }
    fs.writeFileSync(path.join(dir, 'refs.json'), JSON.stringify(corpus, null, 1));
    console.log('WAV ' + id + ': ' + corpus.length + ' files');
    await page.evaluate(() => window.__ttsClient.dispose());
  }
};
