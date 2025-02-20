// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Expose selected APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: ipcRenderer
});
