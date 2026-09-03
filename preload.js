const { contextBridge, ipcRenderer } = require("electron");

// --- API preload minimale ---------------------------------------------------
// Le renderer ne reçoit que des fonctions explicites. Il n'a jamais accès à
// require, process, fs, ipcRenderer directement, ni aux classes TypeScript du
// projet non compilées.

contextBridge.exposeInMainWorld('electronAPI', {
    navigate: (page) => ipcRenderer.invoke('navigate', page),
    obtenirUtilisateurs: () => ipcRenderer.invoke('obtenir-utilisateurs'),
    obtenirConversationsPrivees: () => ipcRenderer.invoke('obtenir-conversations-privees'),
    obtenirMessagesPrive: (conversationId) => ipcRenderer.invoke('obtenir-messages-prive', conversationId),
    envoyerMessagePrive: (conversationId, contenu) => ipcRenderer.invoke('envoyer-message-prive', conversationId, contenu),
});