// Paints the graffiti murals of the walls (app/src/world/wall-art.js) off the main thread: one OffscreenCanvas per
// wall, sent back as raw RGBA bytes as soon as it is done (app/src/world/walls.js puts them on the graphics card a
// strip per frame). A newer request makes the running one stop after its current wall. `lang` picks the words
// (German or English).
// { type: 'plan' } only plans a mural and answers with its words (for the checks). { type: 'recycle' } brings uploaded
// bytes back: they are let go here, off the main thread.
import { planMural, paintWall, MURAL_WORDS, muralLang } from '../world/wall-art.js';

let latest = 0;

self.onmessage = async (e) => {
  const m = e.data;
  if (m?.type === 'plan') {
    try {
      const plan = planMural(m.walls, m.seed, m.lang);
      self.postMessage({ type: 'plan', id: m.id, lang: plan.lang, seed: plan.seed, words: plan.stats.words, throws: plan.stats.throwWords, allowed: MURAL_WORDS[muralLang(m.lang)] });
    } catch (err) { self.postMessage({ type: 'error', id: m.id, message: String(err?.stack || err) }); }
    return;
  }
  if (m?.type !== 'paint') return;
  latest = m.id;
  const t0 = performance.now();
  try {
    const plan = planMural(m.walls, m.seed, m.lang);
    for (const wall of m.walls) {
      if (latest !== m.id) return;
      const density = wall.density || m.density;
      const w = Math.max(1, Math.round(wall.len * density)), h = Math.max(1, Math.round((wall.y1 - wall.y0) * density));
      const canvas = new OffscreenCanvas(w, h);
      paintWall(canvas, wall, plan, density);
      // (the painter's context reads back cheaply: willReadFrequently keeps it on the processor)
      const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      self.postMessage({ type: 'wall', id: m.id, wall: wall.id, data, w, h }, [data.buffer]);
      // let a newer request in between two walls
      await new Promise((r) => setTimeout(r, 0));
    }
    self.postMessage({ type: 'done', id: m.id, ms: performance.now() - t0, stats: plan.stats });
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err?.stack || err) });
  }
};
