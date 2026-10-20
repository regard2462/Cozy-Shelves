// Audiobooks in the main process: the folders in settings.audiobooks.folders are scanned (library.js, scan.js), their
// files become servable through lfile:// (the allowed roots of electron/main.js), and the renderer talks to it with
// api.invoke('audiobooks:…') and api.on('audiobooks:…'):
//   state() → { folders, books, scan }   book(id) → the record with tracks and chapters
//   addFolder() (system dialog) · removeFolder(path) · rescan() · progress(id, patch) · trackDuration(id, i, s)
//   reveal(id) (the folder in Explorer)
// Events: 'audiobooks:update' (state), 'audiobooks:scan' (progress of a scan), 'audiobooks:progress' ({ id, progress }).
// COZYSHELVES_AUDIOBOOKS=<folder>[;<folder>] fills an empty list of audiobook folders (test runs, like COZYSHELVES_BOOKS).
const fs = require('fs');
const path = require('path');
const { AudiobookLibrary } = require('./library');

let lib = null;

/** The URL of a local file for the renderer, in the format of lfile:// (electron/main.js lfileUrl), without adding
 *  every track's folder to the allowed roots one by one: the audiobook folders are allowed as a whole. */
const fileUrl = (p) => `lfile://local/${Buffer.from(p, 'utf8').toString('base64url')}/${encodeURIComponent(path.basename(p))}`;

/** Covers in two sizes as JPEG next to `base` (…-thumb.jpg 320 px, …-large.jpg 960 px) and their mean colour. */
function makeThumbs(buf, base) {
  const { nativeImage } = require('electron');
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const out = {};
  for (const [name, max, q] of [['thumb', 320, 84], ['large', 960, 88]]) {
    const k = Math.min(1, max / Math.max(width, height));
    const im = k < 1 ? img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'best' }) : img;
    const file = `${base}-${name}.jpg`;
    fs.writeFileSync(file, im.toJPEG(q));
    out[name] = file;
  }
  try {
    const px = img.resize({ width: 1, height: 1, quality: 'best' }).toBitmap();   // BGRA
    if (px.length >= 3) out.color = '#' + [px[2], px[1], px[0]].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch {}
  return out;
}

function register({ ipcMain, app, settings, broadcast, dialog, allowedRoots, getMainWindow }) {
  const folders = () => { const a = settings.get('audiobooks'); return Array.isArray(a?.folders) ? a.folders.filter((f) => f && typeof f.path === 'string' && f.path) : []; };
  // test runs: COZYSHELVES_AUDIOBOOKS fills an empty list
  if (process.env.COZYSHELVES_AUDIOBOOKS && !folders().length) {
    const list = process.env.COZYSHELVES_AUDIOBOOKS.split(';').map((p) => p.trim()).filter(Boolean).map((p) => ({ path: p }));
    settings.set('audiobooks', { ...(settings.get('audiobooks') || {}), folders: list });
  }
  const userData = app.getPath('userData');
  lib = new AudiobookLibrary({ userData, getFolders: folders, emit: broadcast, urlFor: fileUrl, makeThumbs });
  // the folders and the covers are servable (lfile://)
  allowedRoots.add(lib.coversDir);
  const allow = () => { for (const f of folders()) allowedRoots.add(f.path); };
  allow();
  let lastKey = JSON.stringify(folders().map((f) => f.path));
  settings.onChange?.(() => {
    const key = JSON.stringify(folders().map((f) => f.path));
    if (key === lastKey) return;
    lastKey = key; allow(); lib.scan();
  });

  const setFolders = (list) => {
    const seen = new Set();
    const clean = (list || []).filter((f) => f && f.path && !seen.has(f.path.toLowerCase()) && seen.add(f.path.toLowerCase())).map((f) => ({ path: f.path }));
    settings.set('audiobooks', { ...(settings.get('audiobooks') || {}), folders: clean });
    // the renderer hears of it like of any change of the settings (the boxes in the cabinet of the hall come or go)
    broadcast('settings:changed', settings.get());
    return clean;
  };
  ipcMain.handle('audiobooks:state', () => lib.state());
  ipcMain.handle('audiobooks:book', (e, id) => lib.book(String(id || '')));
  ipcMain.handle('audiobooks:addFolder', async () => {
    const en = settings.get('language') === 'en';
    const r = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'], title: en ? 'Choose an audiobook folder' : 'Hörbuchordner wählen' });
    if (r.canceled || !r.filePaths?.[0]) return null;
    const list = setFolders([...folders(), { path: r.filePaths[0] }]);
    allowedRoots.add(r.filePaths[0]);
    return list;
  });
  ipcMain.handle('audiobooks:removeFolder', (e, p) => setFolders(folders().filter((f) => f.path !== p)));
  ipcMain.handle('audiobooks:rescan', () => { lib.scan(); return true; });
  ipcMain.handle('audiobooks:progress', (e, id, patch) => lib.setProgress(String(id || ''), patch || {}));
  ipcMain.handle('audiobooks:trackDuration', (e, id, index, seconds) => lib.setTrackDuration(String(id || ''), index | 0, Number(seconds)));
  ipcMain.handle('audiobooks:reveal', (e, id) => {
    const b = lib.byId.get(String(id || ''));
    if (b && !process.env.COZYSHELVES_HIDDEN) require('electron').shell.showItemInFolder(b.kind === 'file' ? b.path : (b.tracks[0]?.path || b.path));
    return !!b;
  });
  app.on('before-quit', () => { try { lib.dispose(); } catch {} });
  // after the first frames of the world (the book folders start at 0.8 s)
  setTimeout(() => lib.scan(), 1500);
}

module.exports = { register, makeThumbs, fileUrl, get library() { return lib; } };
