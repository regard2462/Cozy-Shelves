// Data layer of the Mediathek panel: the IPC calls of electron/mediathek plus the state several views
// share (Merkliste, playback progress, downloads). Views subscribe with store.on(fn) → fn(topic).
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';
import { tr } from '../../core/i18n.js';
import { setChannels } from './format.js';

const call = (name, ...args) => {
  if (!api?.invoke) return Promise.reject(new Error(tr({ de: 'Die Mediathek gibt es nur in der Desktop-App.', en: 'The Mediathek needs the desktop app.' })));
  return api.invoke('mediathek:' + name, ...args);
};

export function createStore() {
  const state = { favorites: [], favIds: new Set(), progress: {}, downloads: new Map(), channels: [], groups: [], live: null, folder: null };
  const subs = new Set();
  const notify = (topic) => { for (const fn of [...subs]) { try { fn(topic); } catch (e) { console.error('[mediathek]', e); } } };
  const offs = [];
  let progressLoad = null;

  const store = {
    state,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    // searches and rows
    query: (opts) => call('query', opts),
    variants: (item) => call('variants', item).catch(() => []),
    topics: (channel) => call('topics', channel),
    liveNow: (ids) => call('liveNow', ids).catch(() => ({})),
    sizes: (item) => call('sizes', item).catch(() => ({})),
    // the English-language sources (0.7): files of an item, topics of a source, the download menu with real sizes
    resolve: (item) => (item && item.source && item.lazy ? call('resolve', item) : Promise.resolve(item)),
    sourceTopics: (id) => call('sourceTopics', id).catch(() => []),
    downloadOptions: (item) => call('downloadOptions', item).catch(() => []),
    async channels() {
      if (!state.channels.length) {
        const r = await call('channels');
        state.channels = r.channels || []; state.groups = r.groups || [];
        setChannels(state.channels);
      }
      return state;
    },
    async live() { if (!state.live) state.live = await call('live'); return state.live; },
    // Merkliste
    async loadFavorites() { state.favorites = await call('favorites').catch(() => []); state.favIds = new Set(state.favorites.map((f) => f.id)); notify('favorites'); return state.favorites; },
    isFavorite: (id) => state.favIds.has(id),
    async toggleFavorite(item) {
      const on = !state.favIds.has(item.id);
      const ok = await call('setFavorite', item, on);
      await store.loadFavorites();
      return on && ok;
    },
    // Weiterschauen
    loadProgress() {
      progressLoad = call('progress').catch(() => ({})).then((p) => { state.progress = p || {}; notify('progress'); return state.progress; });
      return progressLoad;
    },
    /** Resolves once the stored positions are known: a film started right after the panel opens waits for them. */
    progressReady: () => progressLoad || Promise.resolve(state.progress),
    progressOf: (id) => state.progress[id] || null,
    continueList: () => call('continue').catch(() => []),
    async forget(id) { await call('forget', id); delete state.progress[id]; notify('progress'); },
    startAt(id) { const e = state.progress[id]; return e && e.state === 'resume' && e.position > 30 ? Math.max(0, e.position - 5) : 0; },
    // downloads
    async loadDownloads() { const list = await call('downloads').catch(() => []); state.downloads = new Map(list.map((d) => [d.id, d])); notify('downloads'); return list; },
    downloadsOf: (itemId) => [...state.downloads.values()].filter((d) => d.item && d.item.id === itemId),
    download: (item, quality) => call('download', item, quality).then((d) => { state.downloads.set(d.id, d); notify('downloads'); return d; }),
    pause: (id) => call('pause', id),
    resume: (id) => call('resume', id),
    async remove(id, files = true) { await call('remove', id, { files }); state.downloads.delete(id); notify('downloads'); },
    playable: (id) => call('playable', id),
    reveal: (id) => call('reveal', id),
    async folder() { state.folder = await call('folder').catch(() => null); return state.folder; },
    async pickFolder() { const f = await call('pickFolder'); if (f) await store.folder(); notify('folder'); return f; },
    async resetFolder() { await call('resetFolder'); await store.folder(); notify('folder'); },
    dispose() { for (const off of offs) { try { off(); } catch {} } subs.clear(); },
  };

  if (api?.on) {
    offs.push(api.on('mediathek:download', (d) => {
      if (!d || !d.id) return;
      if (d.removed) state.downloads.delete(d.id); else state.downloads.set(d.id, d);
      notify('downloads');
    }));
  }
  // the player reports positions; keep progress bars and "Weiterschauen" current
  offs.push(bus.on('media:position', ({ id, entry }) => {
    if (!id) return;
    if (entry) state.progress[id] = { position: entry.position, duration: entry.duration, state: entry.state };
    else delete state.progress[id];
    notify('progress');
  }));
  return store;
}
