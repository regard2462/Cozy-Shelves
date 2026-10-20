// Panel development harness: dev.html?panel=chess&param=value
import { api } from './core/api.js';
import { bus } from './core/bus.js';
import { i18n } from './core/i18n.js';
import { audio } from './audio/engine.js';
import { initPanels, openPanel, closePanel, dispatchPanelKey } from './ui/panels.js';
import { h } from './core/dom.js';

const params = Object.fromEntries(new URLSearchParams(location.search));
const name = params.panel || 'menu';
delete params.panel;
initPanels(document.getElementById('panels'));
const toast = (msg) => { const el = h('div.toast', msg); document.getElementById('toasts').appendChild(el); setTimeout(() => el.classList.add('fade'), 2500); setTimeout(() => el.remove(), 3100); };
(async () => {
  await api.library._ensureCovers?.();
  const settings = await api.settings.get();
  const lib = await api.library.getState();
  const state = { settings, basket: [], library: lib, player: { x: 0, y: 1.65, z: 0 } };
  const world = { teleport() {}, places: () => [{ id: 'fireplace', label: 'Kamin', group: 'Halle' }], hangPainting() {}, setPaintings() {}, setWeather() {}, setLight() {} };
  const ctx = { api, bus, i18n, audio, state, toast, world };
  window.__ctx = ctx; window.__openPanel = (n, p) => openPanel(n, p, ctx);
  await openPanel(name, params, ctx);
  document.addEventListener('keydown', (e) => { if (dispatchPanelKey(e)) return; if (e.key === 'Escape') closePanel(); });
})();
