// Probe: CacheStorage and WebGPU adapter availability in the app window and in a worker.
module.exports = async ({ page, sleep }) => {
  await page.waitForFunction(() => window.__app, null, { timeout: 240000 });
  const r = await page.evaluate(async () => {
    const out = {};
    try { const c = await caches.open('probe'); await c.put('https://example.org/x', new Response('hi')); out.windowCache = (await (await c.match('https://example.org/x')).text()); } catch (e) { out.windowCache = 'ERR ' + e.message; }
    try { out.gpu = !!navigator.gpu; out.adapter = navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : null; } catch (e) { out.adapter = 'ERR ' + e.message; }
    const src = `self.onmessage = async () => { const o = {}; try { const c = await caches.open('probe-w'); await c.put('https://example.org/y', new Response('w')); o.cache = await (await c.match('https://example.org/y')).text(); } catch (e) { o.cache = 'ERR ' + e.message; } try { o.adapter = navigator.gpu ? !!(await navigator.gpu.requestAdapter()) : null; } catch (e) { o.adapter = 'ERR ' + e.message; } postMessage(o); };`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    out.worker = await new Promise((res) => { w.onmessage = (e) => res(e.data); w.onerror = (e) => res('worker error ' + e.message); w.postMessage(1); setTimeout(() => res('timeout'), 8000); });
    w.terminate();
    return out;
  });
  console.log('PROBE ' + JSON.stringify(r));
  await sleep(200);
};
