// The audiobooks as the renderer knows them (electron/audiobooks): the list, the folders and the scan, kept current by
// the events of the main process. Everything that shows audiobooks (the panel, the settings, the mini player, the
// cabinet in the hall) reads from here; bus 'audiobooks:change' ({ reason, id? }) after every change.
import { api } from '../../core/api.js';
import { bus } from '../../core/bus.js';

const state = { books: [], folders: [], scan: null, loaded: false };
let byId = new Map();
let started = null;

function apply(s, reason = 'update') {
  if (!s) return;
  state.books = Array.isArray(s.books) ? s.books : [];
  state.folders = Array.isArray(s.folders) ? s.folders : [];
  if (s.scan) state.scan = s.scan;
  state.loaded = true;
  byId = new Map(state.books.map((b) => [b.id, b]));
  bus.emit('audiobooks:change', { reason });
}

/** Newest first: the one playing now, then the ones heard most recently, then the ones added most recently. */
export function recentOrder(books, currentId = null) {
  return [...books].sort((a, b) => (b.id === currentId) - (a.id === currentId)
    || (b.progress?.lastPlayed || 0) - (a.progress?.lastPlayed || 0)
    || (b.added || 0) - (a.added || 0)
    || String(a.title).localeCompare(String(b.title), 'de', { numeric: true }));
}
/** "Weiterhören": begun, not finished, the most recent first. */
export function continueList(books) {
  return books.filter((b) => b.progress && !b.progress.finished && (b.progress.position || 0) > 1)
    .sort((a, b) => (b.progress.lastPlayed || 0) - (a.progress.lastPlayed || 0));
}
/** 0…1, how far the listener is in an audiobook (finished = 1). */
export const progressOf = (b) => (b?.progress?.finished ? 1 : b?.progress && b.duration ? Math.min(1, (b.progress.position || 0) / b.duration) : 0);

export const abStore = {
  get books() { return state.books; },
  get folders() { return state.folders; },
  get scan() { return state.scan; },
  get loaded() { return state.loaded; },
  get(id) { return byId.get(id) || null; },
  /** Load the state once and follow the main process from then on. */
  start() {
    if (started) return started;
    api.on?.('audiobooks:update', (s) => apply(s));
    api.on?.('audiobooks:scan', (sc) => { state.scan = sc; bus.emit('audiobooks:change', { reason: 'scan' }); });
    api.on?.('audiobooks:progress', ({ id, progress } = {}) => {
      const b = byId.get(id); if (!b) return;
      b.progress = progress; bus.emit('audiobooks:change', { reason: 'progress', id });
    });
    started = this.refresh();
    return started;
  },
  async refresh() { try { apply(await api.invoke('audiobooks:state'), 'load'); } catch (e) { console.warn('[audiobooks] state', e); } return state; },
  /** The record with tracks and chapters (null when unknown). */
  book: (id) => api.invoke('audiobooks:book', id),
  addFolder: () => api.invoke('audiobooks:addFolder'),
  removeFolder: (p) => api.invoke('audiobooks:removeFolder', p),
  rescan: () => api.invoke('audiobooks:rescan'),
  /** Where the listener is: { track, offset, position, duration, finished, rate, reset, touch }. */
  saveProgress(id, patch) {
    const b = byId.get(id);
    return api.invoke('audiobooks:progress', id, patch).then((p) => { if (b && p) { b.progress = p; bus.emit('audiobooks:change', { reason: 'progress', id }); } return p; }).catch(() => null);
  },
  trackDuration: (id, index, seconds) => api.invoke('audiobooks:trackDuration', id, index, seconds).catch(() => false),
  reveal: (id) => api.invoke('audiobooks:reveal', id),
  onChange: (fn) => bus.on('audiobooks:change', fn),
};
export default abStore;
