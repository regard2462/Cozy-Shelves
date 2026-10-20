// Makes sound material off the main thread (app/src/audio/offthread.js): the looping textures of the soundscape and
// footsteps made ahead. The samples go back as transferred Float32Arrays.
import { makeTexture } from '../audio/textures.js';
import { stepSamples } from '../audio/steps.js';

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.type === 'texture') {
      const data = makeTexture(m.name, m.sr);
      self.postMessage({ id: m.id, data }, data ? [data.buffer] : []);
    } else if (m.type === 'steps') {
      const list = Array.from({ length: Math.max(1, Math.min(8, m.n || 1)) }, () => stepSamples(m.sr, m.o || {}));
      self.postMessage({ id: m.id, list }, list.map((d) => d.buffer));
    } else self.postMessage({ id: m.id, error: 'unknown job' });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err?.stack || err) });
  }
};
