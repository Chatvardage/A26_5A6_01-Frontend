const { contextBridge, ipcRenderer } = require('electron');

// --- API preload minimale ---------------------------------------------------
// Principe : le renderer n'a JAMAIS accès à ipcRenderer, require, process, fs,
// etc. Il n'a accès qu'aux méthodes explicitement listées ci-dessous.
// Contrairement à un passthrough générique (send/on avec un nom de canal
// arbitraire), chaque canal IPC est fixé ici en dur, dans le preload — le
// renderer ne peut pas choisir ou inventer un canal.
//
// Rien n'est exposé pour l'instant (l'exemple ping/pong utilisé pour valider
// le câblage contextIsolation/preload lors de l'issue #8 a été retiré, la
// nouvelle UI ne l'utilise plus). Ajouter ici une méthode nommée par nouveau
// besoin métier réel (ex. ChatGateway : envoyer un message, rejoindre un
// salon...), jamais un send/on générique à canal arbitraire.
contextBridge.exposeInMainWorld('electronAPI', {});

contextBridge.exposeInMainWorld('notifications', {
  setActiveConversation: (conversationId) =>
    ipcRenderer.invoke('notification:set-active-conversation', conversationId),
  messageReceived: (message) =>
    ipcRenderer.invoke('notification:message-received', message),
});
