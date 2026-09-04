const { contextBridge, ipcRenderer } = require('electron');

// --- API preload minimale ---------------------------------------------------
// Principe : le renderer n'a JAMAIS accès à ipcRenderer, require, process, fs,
// etc. Il n'a accès qu'aux méthodes explicitement listées ci-dessous.
// Contrairement à un passthrough générique (send/on avec un nom de canal
// arbitraire), chaque canal IPC est fixé ici en dur, dans le preload — le
// renderer ne peut pas choisir ou inventer un canal.
//
// `messageRead` a été retiré : ce canal n'était pas enregistré côté main.js
// (aucun `ipcMain.handle('notification:message-read', ...)`) et n'était
// appelé nulle part côté renderer — un appel aurait simplement rejeté avec
// "No handler registered". L'état lu/non lu est désormais géré entièrement
// côté renderer via NotifPrefs (localStorage), voir
// javascript/notif-prefs.js : pas besoin d'aller-retour IPC pour ça.
contextBridge.exposeInMainWorld('notifications', {
  setActiveConversation: (conversationId) =>
    ipcRenderer.invoke('notification:set-active-conversation', conversationId),
  messageReceived: (message) =>
    ipcRenderer.invoke('notification:message-received', message),
  // Écoute les messages simulés en continu par main.js (démo des
  // notifications, voir demarrerSimulationMessages) : contrairement aux deux
  // méthodes ci-dessus, ce canal part du main process vers le renderer
  // (ipcRenderer.on, pas invoke), puisque main.js pousse ces messages de son
  // propre chef plutôt qu'en réponse à un appel du renderer. Retourne une
  // fonction pour se désabonner, au cas où elle serait utile un jour.
  onMockMessage: (callback) => {
    const ecouteur = (_event, message) => callback(message);
    ipcRenderer.on('notifications:message-simule', ecouteur);
    return () =>
      ipcRenderer.removeListener('notifications:message-simule', ecouteur);
  },
  // Badge de messages non lus sur l'icône de l'app (dock macOS/Linux,
  // superposition sur la barre des tâches Windows). `iconDataUrl` est un
  // PNG en dataURL dessiné côté renderer (voir genererIconeBadge dans
  // renderer.js / message-prive.js) : main.js n'a pas accès à <canvas>.
  setBadgeCount: (count, iconDataUrl) =>
    ipcRenderer.invoke('notifications:set-badge-count', { count, iconDataUrl }),
});

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
  demarrerConversationPrivee: (donnees) =>
    ipcRenderer.invoke('demarrer-conversation-privee', donnees),
});
