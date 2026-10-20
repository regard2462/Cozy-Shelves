// Sound material made off the main thread: the looping textures of textures.js (rain, leaves, crickets) take tens of
// milliseconds each to make and footsteps (steps.js) a millisecond or two; made in a worker
// (app/src/workers/sound-worker.js) they never hold up a frame. offthread(job) → Promise of the reply, or null when
// there is no worker (then the caller makes it itself).
let worker = null, failed = false, seq = 0;
const waiting = new Map();
/** How many jobs the worker did, and whether it failed (the checks read it). */
export const offthreadStats = { done: 0, failed: false };

function get() {
  if (worker || failed || typeof Worker === 'undefined') return worker;
  try {
    worker = new Worker(new URL('./sound-worker.js', import.meta.url), { type: 'module', name: 'sound' });
    worker.onmessage = (e) => { const done = waiting.get(e.data?.id); waiting.delete(e.data?.id); if (!e.data?.error) offthreadStats.done++; done?.(e.data); };
    worker.onerror = (e) => {
      console.warn('[audio] sound worker', e?.message || e);
      failed = true; worker = null; offthreadStats.failed = true;
      for (const done of waiting.values()) done(null);
      waiting.clear();
    };
  } catch (e) { console.warn('[audio] no sound worker', e); failed = true; worker = null; offthreadStats.failed = true; }
  return worker;
}

/** Send a job to the worker: { type: 'texture', name, sr } | { type: 'steps', sr, o, n }. */
export function offthread(job) {
  const w = get();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => { waiting.set(id, resolve); w.postMessage({ ...job, id }); });
}
