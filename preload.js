const { contextBridge, ipcRenderer } = require('electron');

// --- API preload minimale ---------------------------------------------------
// Principe : le renderer n'a JAMAIS accès à ipcRenderer, require, process, fs,
// etc. Il n'a accès qu'aux méthodes explicitement listées ci-dessous.
// Contrairement à un passthrough générique (send/on avec un nom de canal
// arbitraire), chaque canal IPC est fixé ici en dur, dans le preload — le
// renderer ne peut pas choisir ou inventer un canal.

contextBridge.exposeInMainWorld('electronAPI', {
  // Infos de runtime (lecture seule, aucun accès Node au-delà de ça).
  nodeVersion: () => process.versions.node,
  chromeVersion: () => process.versions.chrome,
  electronVersion: () => process.versions.electron,

  // Exemple d'IPC scoped : un seul canal fixe dans chaque sens, déclaré en
  // dur ici. Le renderer ne peut pas choisir/inventer un nom de canal
  // (contrairement à un passthrough générique send(channel, data)).
  ping: () => ipcRenderer.send('ping'),
  onPong: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('pong', listener);
    return () => ipcRenderer.removeListener('pong', listener);
  },

  // Ajouter ici une méthode nommée par nouveau besoin métier (ex: plus tard
  // pour le ChatGateway), jamais un send/on générique à canal arbitraire.
});
