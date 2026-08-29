const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    nodeVersion: () => process.versions.node,
    chromeVersion: () => process.versions.chrome,
    electronVersion: () => process.versions.electron,
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
});