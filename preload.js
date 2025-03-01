// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld("electronAPI", {
  getSharedPrinters: () => ipcRenderer.invoke("get-shared-printers"),
});

// Expose selected APIs to the renderer process
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: ipcRenderer
});
