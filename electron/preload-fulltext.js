// Preload of the hidden window that reads books for the full-text search (app/fulltext.html → app/src/search/extract.js,
// electron/search/fulltext.js creates it on demand and closes it when there is nothing to read).
const { contextBridge, ipcRenderer, webFrame } = require('electron');
contextBridge.exposeInMainWorld('fulltextApi', {
  onFulltextJob: (fn) => ipcRenderer.on('fulltext-job', (e, job) => fn(job)),
  onFulltextGate: (fn) => ipcRenderer.on('fulltext-gate', (e, open) => fn(open)),
  onFulltextAbort: (fn) => ipcRenderer.on('fulltext-abort', (e, jobId) => fn(jobId)),
  fulltextSource: (id) => ipcRenderer.invoke('fulltext:source', id),
  fulltextUnits: (jobId, units, next, info) => ipcRenderer.invoke('fulltext:units', jobId, units, next, info),
  fulltextEnd: (jobId, result) => ipcRenderer.invoke('fulltext:end', jobId, result),
  fulltextHello: () => ipcRenderer.send('fulltext:hello'),
  // after a book: Blink's caches of the page may go (they keep resources of earlier books otherwise)
  fulltextCollect: () => { try { webFrame.clearCache(); } catch {} },
});
