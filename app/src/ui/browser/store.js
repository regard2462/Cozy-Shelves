// The browser's collections: bookmarks (with folders), reading list ("Später lesen") with progress, history,
// recently closed tabs and the open tabs of the last session. They live in <userData>/browser-data.json
// (electron/browser, 'browser:data:*'), not in settings.json: history and reading progress change on every
// page, and every settings write is broadcast to the whole app.
import { cleanUrl, hostOf, isWeb, samePage, uid } from './util.js';

const MAX = { history: 800, closed: 25, readingList: 500, bookmarks: 1000 };

export function createStore(api) {
  const d = { bookmarks: [], readingList: [], history: [], closed: [], session: null };
  const dirty = new Set();
  let timer = null, loaded = false;
  const listeners = new Set();
  const invoke = (ch, ...a) => (typeof api?.invoke === 'function' ? api.invoke(ch, ...a) : Promise.resolve(null));

  async function load(legacy) {
    let got = null;
    try { got = await invoke('browser:data:get'); } catch { got = null; }
    if (got && typeof got === 'object') {
      for (const k of Object.keys(d)) if (k in got) d[k] = got[k] ?? d[k];
    }
    // bookmarks and history of the first browser version lived in settings.browser
    if (legacy && !d.bookmarks.length && !d.history.length) {
      if (Array.isArray(legacy.bookmarks) && legacy.bookmarks.length) { d.bookmarks = legacy.bookmarks.filter((b) => isWeb(b?.url)).map((b) => ({ id: uid(), url: b.url, title: b.title || hostOf(b.url), folder: '', at: b.at || Date.now() })); dirty.add('bookmarks'); }
      if (Array.isArray(legacy.history) && legacy.history.length) { d.history = legacy.history.filter((e) => isWeb(e?.url)).map((e) => ({ url: e.url, title: e.title || hostOf(e.url), at: e.at || Date.now(), visits: 1 })); dirty.add('history'); }
      if (dirty.size) save();
    }
    for (const b of d.bookmarks) if (!b.id) b.id = uid();
    loaded = true;
    emit();
    return d;
  }

  function save(key) {
    if (key) dirty.add(key);
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  }
  function flush() {
    clearTimeout(timer); timer = null;
    if (!dirty.size) return Promise.resolve();
    const patch = {};
    for (const k of dirty) patch[k] = d[k];
    dirty.clear();
    return Promise.resolve(invoke('browser:data:set', patch)).catch(() => {});
  }
  function emit() { for (const fn of listeners) { try { fn(d); } catch (e) { console.error('[browser] store listener', e); } } }
  const changed = (key) => { save(key); emit(); };

  // ---- history ---------------------------------------------------------------------------------------------------
  function visit(url, title) {
    if (!isWeb(url)) return;
    const u = cleanUrl(url);
    const i = d.history.findIndex((e) => e.url === u);
    const prev = i >= 0 ? d.history.splice(i, 1)[0] : null;
    d.history.unshift({ url: u, title: title || prev?.title || hostOf(u), at: Date.now(), visits: (prev?.visits || 0) + 1 });
    if (d.history.length > MAX.history) d.history.length = MAX.history;
    changed('history');
  }
  function retitle(url, title) {
    if (!title) return;
    const u = cleanUrl(url);
    const e = d.history.find((x) => x.url === u);
    if (e && e.title !== title) { e.title = title; save('history'); }
    const r = d.readingList.find((x) => samePage(x.url, u));
    if (r && (!r.title || r.title === hostOf(r.url))) { r.title = title; save('readingList'); }
  }
  function forget(url) { d.history = d.history.filter((e) => e.url !== url); changed('history'); }
  function clearHistory(sinceMs) {
    d.history = sinceMs ? d.history.filter((e) => e.at < Date.now() - sinceMs) : [];
    changed('history');
  }

  // ---- bookmarks ---------------------------------------------------------------------------------------------------
  const bookmarkOf = (url) => d.bookmarks.find((b) => samePage(b.url, cleanUrl(url)));
  function addBookmark(url, title, folder = '') {
    if (!isWeb(url) || bookmarkOf(url)) return bookmarkOf(url);
    const b = { id: uid(), url: cleanUrl(url), title: title || hostOf(url), folder, at: Date.now() };
    d.bookmarks.unshift(b);
    changed('bookmarks');
    return b;
  }
  function updateBookmark(id, patch) {
    const b = d.bookmarks.find((x) => x.id === id);
    if (!b) return;
    if (typeof patch.title === 'string') b.title = patch.title.trim() || b.title;
    if (typeof patch.folder === 'string') b.folder = patch.folder.trim().slice(0, 80);
    changed('bookmarks');
  }
  function removeBookmark(id) { d.bookmarks = d.bookmarks.filter((b) => b.id !== id); changed('bookmarks'); }
  const folders = () => [...new Set(d.bookmarks.map((b) => b.folder || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));

  // ---- reading list -------------------------------------------------------------------------------------------------
  const laterOf = (url) => d.readingList.find((x) => samePage(x.url, cleanUrl(url)));
  function addLater(url, title, mode = 'web', progress = 0) {
    if (!isWeb(url)) return null;
    const have = laterOf(url);
    if (have) return have;
    const it = { url: cleanUrl(url), title: title || hostOf(url), site: hostOf(url), addedAt: Date.now(), progress: Math.max(0, Math.min(1, progress || 0)), mode, read: false };
    d.readingList.unshift(it);
    if (d.readingList.length > MAX.readingList) d.readingList.length = MAX.readingList;
    changed('readingList');
    return it;
  }
  function removeLater(url) { d.readingList = d.readingList.filter((x) => !samePage(x.url, url)); changed('readingList'); }
  /** Reading progress of a page on the list (0..1, the reader page or the scroll position). */
  function progress(url, value, mode) {
    const it = laterOf(url);
    if (!it || !Number.isFinite(value)) return;
    const v = Math.max(0, Math.min(1, value));
    if (Math.abs((it.progress || 0) - v) < 0.004 && (!mode || it.mode === mode)) return;
    it.progress = v;
    if (mode) it.mode = mode;
    if (v >= 0.985 && !it.read) { it.read = true; it.readAt = Date.now(); }
    save('readingList');
    emit();
  }
  function setRead(url, read) { const it = laterOf(url); if (!it) return; it.read = !!read; it.readAt = read ? Date.now() : undefined; if (!read) it.progress = Math.min(it.progress || 0, 0.95); changed('readingList'); }

  // ---- tabs ----------------------------------------------------------------------------------------------------------
  function closedTab(t) {
    if (!isWeb(t.url)) return;
    d.closed = [{ url: t.url, title: t.title || hostOf(t.url), mode: t.mode === 'reader' ? 'reader' : 'web', frac: t.frac || 0, at: Date.now() }, ...d.closed.filter((c) => c.url !== t.url)].slice(0, MAX.closed);
    changed('closed');
  }
  function popClosed(url) {
    const i = url ? d.closed.findIndex((c) => c.url === url) : 0;
    if (i < 0 || !d.closed.length) return null;
    const [c] = d.closed.splice(i, 1);
    changed('closed');
    return c;
  }
  function saveSession(session) { d.session = session; save('session'); }

  return {
    get data() { return d; }, get loaded() { return loaded; },
    load, flush, onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    visit, retitle, forget, clearHistory,
    bookmarkOf, addBookmark, updateBookmark, removeBookmark, folders,
    laterOf, addLater, removeLater, progress, setRead,
    closedTab, popClosed, saveSession,
  };
}
