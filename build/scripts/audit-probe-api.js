// Probe: the renderer's api wrapper (app/src/core/api.js). Every namespace of window.api is there, invoke/on
// work, synchronous functions return their value, and rejected IPC calls lose Electron's message prefix.
const kit = require('./audit-lib');

module.exports = async (env) => {
  const k = kit(env);
  const { page, log } = k;
  await k.boot();
  const r = await page.evaluate(async () => {
    const api = window.__app.ctx.api;
    const out = {};
    out.namespaces = Object.keys(window.api).every((ns) => typeof api[ns] === typeof window.api[ns]);
    out.sameFunctions = Object.keys(window.api).filter((ns) => typeof window.api[ns] === 'object').every((ns) => Object.keys(window.api[ns]).every((fn) => typeof api[ns][fn] === typeof window.api[ns][fn]));
    out.coverUrl = api.library.coverUrl('abc');
    const off = api.on('probe:channel', () => {});
    out.onReturnsFunction = typeof off === 'function';
    off();
    const offSettings = api.settings.onChange(() => {});
    out.onChangeReturnsFunction = typeof offSettings === 'function';
    offSettings();
    out.settings = !!(await api.settings.get()).language;
    out.invokeOk = Array.isArray((await api.invoke('feeds:list')).feeds);
    try { await api.invoke('catalog:search', 'unknown-source', 'x', {}); } catch (e) { out.cleanedError = e.message; }
    try { await window.api.invoke('catalog:search', 'unknown-source', 'x', {}); } catch (e) { out.rawError = e.message; }
    return out;
  });
  log('API ' + JSON.stringify(r));
  log('ERRORS ' + JSON.stringify(k.errors.slice(0, 10)));
};
