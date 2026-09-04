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
contextBridge.exposeInMainWorld('electronAPI', {
  obtenirEtatSalons: (utilisateurId) =>
    ipcRenderer.invoke('salons:etat', { utilisateurId }),
  creerSalon: (donnees) => ipcRenderer.invoke('salons:creer', donnees),
  inviterAuSalon: (donnees) => ipcRenderer.invoke('salons:inviter', donnees),
  accepterInvitation: (donnees) =>
    ipcRenderer.invoke('salons:accepter-invitation', donnees),
  refuserInvitation: (donnees) =>
    ipcRenderer.invoke('salons:refuser-invitation', donnees),
  envoyerMessageSalon: (donnees) =>
    ipcRenderer.invoke('salons:envoyer-message', donnees),
  navigate: (page) => ipcRenderer.invoke('navigate', page),
  obtenirUtilisateurs: () => ipcRenderer.invoke('utilisateurs:lister'),
  obtenirConversationsPrivees: (utilisateurId) =>
    ipcRenderer.invoke('obtenir-conversations-privees', { utilisateurId }),
  envoyerMessagePrive: (donnees) =>
    ipcRenderer.invoke('envoyer-message-prive', donnees),
});