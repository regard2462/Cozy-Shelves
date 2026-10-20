const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('indexerApi', {
  onJob: (fn) => ipcRenderer.on('index-job', (e, job) => fn(job)),
  result: (id, result) => ipcRenderer.invoke('indexer:result', id, result),
  ready: () => ipcRenderer.invoke('indexer:ready'),
  // pictures the main process wants decoded and measured (covers from the internet, the check of page 1)
  onImageJob: (fn) => ipcRenderer.on('image-job', (e, job) => fn(job)),
  imageResult: (id, result) => ipcRenderer.invoke('indexer:image-result', id, result),
});
