const { contextBridge, ipcRenderer } = require('electron');

// --- API preload minimale ---------------------------------------------------
// Principe : le renderer n'a JAMAIS accès à ipcRenderer, require, process, fs,
// etc. Il n'a accès qu'aux méthodes explicitement listées ci-dessous.
// Contrairement à un passthrough générique (send/on avec un nom de canal
// arbitraire), chaque canal IPC est fixé ici en dur, dans le preload — le
// renderer ne peut pas choisir ou inventer un canal.
//
// allerAuTableauDeBord : utilisée par la page de connexion (LoginPage.tsx)
// une fois la session locale établie, pour demander au processus main de
// naviguer vers le dashboard (voir main.js, canal 'navigation:tableau-de-bord').
// Prochaine méthode à ajouter ici : le ChatGateway réel (salons, messages,
// DM...), sur le même principe d'un canal nommé par besoin métier.
contextBridge.exposeInMainWorld('electronAPI', {
  allerAuTableauDeBord: () => ipcRenderer.invoke('navigation:tableau-de-bord'),
});
