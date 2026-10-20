// Probe: real-time factor of every installed German voice inside the renderer, per device, through the workers the
// app uses (synthesis into buffers only, nothing is played).
//   COZYSHELVES_PIPER_DIR=<copy of the voice files> node build/screenshot.js tts-rtf-probe
// PROBE_VOICES=id,id limits the voices, PROBE_DEVICES=webgpu,wasm forces the devices (default: WebGPU and the CPU for
// the heavy voices, the CPU for the light ones), PROBE_WAV_DIR=<folder> keeps every synthesized sentence as a WAV.
const fs = require('fs');
const path = require('path');

module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app && window.api, null, { timeout: 240000 });
  await sleep(1500);
  const voices = await page.evaluate(async () => (await window.api.invoke('tts:piperVoices')).voices.filter((v) => v.installed).map((v) => ({ id: v.id, gpu: !!v.gpu })));
  console.log('INSTALLED ' + voices.map((v) => v.id).join(' '));
  const only = (process.env.PROBE_VOICES || '').split(',').filter(Boolean);
  const sentences = [
    'Guten Tag, das ist ein Test.',
    'Die Zeitung berichtete über die Bundesregierung und ihre neuen Pläne für das kommende Jahr.',
    'Im neunzehnten Jahrhundert wuchsen die Städte sehr schnell, und viele Menschen zogen vom Land in die Fabriken, wo sie unter schwierigen Bedingungen arbeiteten.',
  ];
  for (const { id, gpu } of voices) {
    if (only.length && !only.includes(id)) continue;
    for (const device of (process.env.PROBE_DEVICES || (gpu ? 'webgpu,wasm' : 'wasm')).split(',')) {
      const res = await page.evaluate(async ([id, device, sentences, keepWav]) => {
        const v = await window.api.invoke('tts:piperEnsure', id, { download: false });
        if (!v?.ok) return { error: v?.error || 'not installed' };
        const file = v.engine === 'kokoro-de' ? 'kokoro-de-worker.js' : 'piper-worker.js';
        const w = new Worker(new URL('dist/' + file, document.baseURI).href, { type: 'module' });
        const voice = { id: v.id, name: v.name, modelUrl: v.modelUrl, config: v.config, voicesUrl: v.voicesUrl, voiceName: v.voiceName, gpu: v.gpu, device };
        const t0 = performance.now();
        const ready = new Promise((resolve, reject) => {
          w.addEventListener('message', (ev) => {
            const m = ev.data || {};
            if (m.type === 'status' && m.state === 'ready') resolve(m.device);
            if (m.type === 'status' && m.state === 'error') reject(new Error(m.message));
          });
        });
        w.postMessage({ type: 'load', voice });
        let dev;
        try { dev = await ready; } catch (e) { w.terminate(); return { error: e.message }; }
        const tLoad = performance.now() - t0;
        const rows = [], wavs = [];
        let synth = 0, audio = 0;
        for (const [k, text] of sentences.entries()) {
          const t1 = performance.now();
          const out = await new Promise((resolve) => {
            const on = (ev) => { const m = ev.data || {}; if (m.id === 'x' + k && (m.type === 'audio' || m.type === 'error')) { w.removeEventListener('message', on); resolve(m); } };
            w.addEventListener('message', on);
            w.postMessage({ type: 'speak', id: 'x' + k, text, speed: 1, voice });
          });
          const dt = performance.now() - t1;
          if (out.type !== 'audio') { rows.push('error ' + out.error); continue; }
          const dur = out.samples.length / out.sampleRate * 1000;
          let peak = 0; for (const x of out.samples) peak = Math.max(peak, Math.abs(x));
          // the first sentence pays for the warm-up (shader compilation on WebGPU)
          if (k > 0) { synth += dt; audio += dur; }
          rows.push(`${dt.toFixed(0)}ms/${dur.toFixed(0)}ms peak ${peak.toFixed(2)} ${out.phonemizer}`);
          if (keepWav) {
            const b = new Int16Array(out.samples.length);
            for (let i = 0; i < b.length; i++) b[i] = Math.max(-32768, Math.min(32767, Math.round(out.samples[i] * 32767)));
            const u8 = new Uint8Array(b.buffer);
            let bin = '';
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
            wavs.push({ name: `${id}-${device}-${k}`, rate: out.sampleRate, b64: btoa(bin) });
          }
        }
        w.postMessage({ type: 'dispose' }); setTimeout(() => w.terminate(), 200);
        return { device: dev, load: Math.round(tLoad), rtf: +(synth / audio).toFixed(3), rows, wavs };
      }, [id, device, sentences, !!process.env.PROBE_WAV_DIR]);
      const wavs = res.wavs || [];
      delete res.wavs;
      console.log(`RTF ${id} ${device}: ${JSON.stringify(res)}`);
      if (process.env.PROBE_WAV_DIR) {
        fs.mkdirSync(process.env.PROBE_WAV_DIR, { recursive: true });
        for (const w of wavs) {
          const pcm = Buffer.from(w.b64, 'base64');
          const h = Buffer.alloc(44);
          h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
          h.writeUInt32LE(w.rate, 24); h.writeUInt32LE(w.rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
          fs.writeFileSync(path.join(process.env.PROBE_WAV_DIR, w.name + '.wav'), Buffer.concat([h, pcm]));
        }
      }
    }
  }
};
