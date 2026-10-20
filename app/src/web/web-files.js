// Where the books of the browser version come from. Three kinds of folder source:
//   'handle'  a FileSystemDirectoryHandle from showDirectoryPicker() (Chromium, Edge, Opera): it is kept in IndexedDB
//             and found again after a reload; reading it then needs the permission once more (a click in the page).
//   'files'   the FileList of <input type="file" webkitdirectory> (Firefox, Safari): read-only, gone with the page, the
//             folder has to be picked again after a reload. The books keep their ids (the folder name and the path
//             inside it), so bookmarks and positions survive.
//   'bridge'  the Android app (android/, docs/strands/android.md): the folder was picked in the system's picker, the
//             app lists it through window.AndroidBooks and serves every file under /books/<key>/<path> of the page's
//             own origin, so fetch() gives the File. Android keeps the permission: no click after a restart.
// The files never leave the device; nothing is copied.
import { MAX_DEPTH, IGNORE_DIRS, skipDir, isBookFile, baseName } from '../../../electron/library/shelving.js';
import { idb } from './idb.js';

const PICKER_ID = 'cozy-shelves-books';
const PAGE_RE = /\.(html?|xhtml|mht|mhtml)$/i;

export const canPickDirectory = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && window.isSecureContext;

// ---- the Android bridge -------------------------------------------------------------------------------------------
/** window.AndroidBooks of the Android app (android/app/src/main/kotlin/.../BooksBridge.kt), or null in a browser. */
export const bridge = () => (typeof window !== 'undefined' && window.AndroidBooks) || null;
export const canPickBridge = () => !!bridge();
const pendingPicks = new Map();   // request id → resolve
/** The system's folder picker of the app: { key, name } of the picked folder, null when cancelled. */
export function pickBridgeFolder() {
  const b = bridge();
  if (!b) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    pendingPicks.set(id, resolve);
    try { b.pickFolder(id); } catch (e) { pendingPicks.delete(id); console.warn('[web-files] pickFolder', e?.message || e); resolve(null); }
  });
}
/** The app's answer (window.__cozyshelvesWeb.androidFolder): resolves the waiting pick; true when one was waiting. */
export function bridgeFolderPicked(result) {
  const r = result || {};
  const resolve = pendingPicks.get(r.requestId);
  pendingPicks.delete(r.requestId);
  if (!resolve) return false;
  resolve(r.key ? { key: String(r.key), name: String(r.name || 'Bücher') } : null);
  return true;
}
/** The address of a file of a bridge folder on the page's origin (every segment encoded, '/' kept). */
export const bridgeUrl = (key, relPath) => `${location.origin}/books/${encodeURIComponent(key)}/${String(relPath).split('/').map(encodeURIComponent).join('/')}`;
/** A folder source of the Android app: `key` names the folder in the app, `name` is what the user sees. */
export function sourceFromBridge({ id, key, name, mode = 'structured' }) {
  const b = bridge();
  let available = false;
  try { available = !!b && !!key && b.hasFolder(key); } catch {}
  return { id: id || newId(), name: name || 'Bücher', mode, kind: 'bridge', key, available };
}

/** The native folder picker (Chromium). null when the user cancelled. Throws when the API is missing. */
export async function pickDirectory() {
  if (!canPickDirectory()) throw new Error('showDirectoryPicker is not available');
  try { return await window.showDirectoryPicker({ id: PICKER_ID, mode: 'read' }); }
  catch (e) { if (e?.name === 'AbortError') return null; throw e; }
}

/** The fallback picker: a hidden <input webkitdirectory>; the FileList of the folder, or null when cancelled. */
export function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.webkitdirectory = true;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    input.dataset.role = 'web-folder-input';
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); window.removeEventListener('focus', onFocus); resolve(files && files.length ? files : null); };
    // a cancelled dialog fires no change event: the window's focus coming back without files is the cancel
    const onFocus = () => setTimeout(() => { if (!done && !input.files?.length) finish(null); }, 800);
    input.addEventListener('change', () => finish(input.files));
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** A folder source from a directory handle (the picker, the OPFS in the checks). */
export function sourceFromHandle(handle, { id, mode = 'structured' } = {}) {
  return { id: id || newId(), name: handle.name || 'Bücher', mode, kind: 'handle', handle, available: true };
}
/** A folder source from a FileList of <input webkitdirectory>: the top folder's name is the first path segment. */
export function sourceFromFiles(files, { id, mode = 'structured' } = {}) {
  const list = [...files];
  const first = list[0]?.webkitRelativePath || '';
  const name = first.includes('/') ? first.split('/')[0] : (list[0]?.name || 'Bücher');
  return { id: id || newId(), name, mode, kind: 'files', files: list, available: true };
}
export const newId = () => 'f' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 'granted' | 'prompt' | 'denied' for a kept handle (handles without the permission API, the OPFS, are granted). */
export async function permissionOf(handle) {
  try { return typeof handle.queryPermission === 'function' ? await handle.queryPermission({ mode: 'read' }) : 'granted'; } catch { return 'denied'; }
}
/** Asks the browser for the permission again (needs a user gesture). true when granted. */
export async function requestPermission(handle) {
  try { return (typeof handle.requestPermission === 'function' ? await handle.requestPermission({ mode: 'read' }) : 'granted') === 'granted'; } catch { return false; }
}

export const saveHandle = (id, handle) => idb.put('handles', id, handle);
export const loadHandle = (id) => idb.get('handles', id);
export const dropHandle = (id) => idb.del('handles', id);

/**
 * The book files of a source: [{ relPath, name, size, mtime, file() → Promise<File> }]. relPath uses '/' and starts
 * below the source's folder. The same folders are skipped as on the desktop (shelving.js skipDir, isBookFile).
 * @returns null when the source cannot be read (no permission, the files of a 'files' source are gone)
 */
export async function listBooks(source) {
  if (source.kind === 'handle') {
    if ((await permissionOf(source.handle)) !== 'granted') return null;
    const out = [];
    try { await walkHandle(source.handle, '', 0, out); } catch (e) { console.warn('[web-files] folder unreadable', source.name, e?.message || e); return null; }
    return out;
  }
  if (source.kind === 'files') {
    if (!source.files?.length) return null;
    return fromFlat([...source.files].map((f) => ({ path: f.webkitRelativePath || f.name, name: f.name, size: f.size, mtime: f.lastModified, file: async () => f })));
  }
  if (source.kind === 'bridge') return fromBridge(source);
  return null;
}

/** The listing of the app (relative paths below the folder); the files come through fetch() of /books/<key>/<path>. */
function fromBridge(source) {
  const b = bridge();
  if (!b || !source.key) return null;
  let json;
  try { json = b.listFiles(source.key); } catch (e) { console.warn('[web-files] listFiles', e?.message || e); return null; }
  if (!json) return null;
  let items;
  try { items = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(items)) return null;
  const fileOf = (relPath, name, size, mtime) => async () => {
    const res = await fetch(bridgeUrl(source.key, relPath), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${relPath}`);
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type, lastModified: mtime || 0 });
  };
  return fromFlat(items.map((e) => ({ path: source.name + '/' + e.relPath, name: e.name, size: +e.size || 0, mtime: +e.mtime || 0, file: fileOf(e.relPath, e.name, +e.size || 0, +e.mtime || 0) })));
}

async function walkHandle(dir, prefix, depth, out) {
  if (depth > MAX_DEPTH) return;
  const entries = [];
  for await (const [name, h] of dir.entries()) entries.push([name, h]);
  // the pages next to their resource folders: "-Dateien" / "-files" only count as such when the page is there
  const pages = new Set(entries.filter(([n, h]) => h.kind === 'file' && PAGE_RE.test(n)).map(([n]) => n.replace(/\.[^.]+$/, '').toLowerCase()));
  for (const [name, h] of entries) {
    if (name.startsWith('.') || IGNORE_DIRS.has(name)) continue;
    if (h.kind === 'directory') { if (!skipDir(name, pages)) await walkHandle(h, prefix + name + '/', depth + 1, out); continue; }
    const relPath = prefix + name;
    let f;
    try { f = await h.getFile(); } catch { continue; }
    if (!isBookFile(name, f.size, relPath)) continue;
    out.push({ relPath, name, size: f.size, mtime: f.lastModified, file: () => h.getFile() });
  }
}

/**
 * A flat list of files with their paths (the FileList of the input, the listing of the Android app) filtered like the
 * walk: [{ path: 'folder/sub/name', name, size, mtime, file() }] → the book entries with their relPath below the folder.
 */
function fromFlat(files) {
  // the directories and the HTML pages in each of them, for the same skipping rules as the walk
  const dirs = new Map();   // dir path → Set of page names
  for (const f of files) {
    const parts = f.path.split('/');
    const dir = parts.slice(0, -1).join('/');
    if (!dirs.has(dir)) dirs.set(dir, new Set());
    if (PAGE_RE.test(f.name)) dirs.get(dir).add(f.name.replace(/\.[^.]+$/, '').toLowerCase());
  }
  const skipped = new Map();   // dir path → skipped?
  const isSkipped = (dirPath) => {
    if (!dirPath) return false;
    if (skipped.has(dirPath)) return skipped.get(dirPath);
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    const parent = parts.slice(0, -1).join('/');
    const yes = isSkipped(parent) || (parts.length > 1 && (name.startsWith('.') || IGNORE_DIRS.has(name) || skipDir(name, dirs.get(parent) || new Set())));
    skipped.set(dirPath, yes);
    return yes;
  };
  const out = [];
  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length - 2 > MAX_DEPTH) continue;
    const dir = parts.slice(0, -1).join('/');
    if (isSkipped(dir)) continue;
    if (f.name.startsWith('.') || IGNORE_DIRS.has(f.name)) continue;
    const relPath = parts.slice(1).join('/');
    if (!isBookFile(f.name, f.size, relPath)) continue;
    out.push({ relPath, name: baseName(relPath), size: f.size, mtime: f.mtime, file: f.file });
  }
  return out;
}
