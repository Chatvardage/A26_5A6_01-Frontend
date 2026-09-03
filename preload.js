const { contextBridge, ipcRenderer } = require('electron');

// --- API preload minimale ---------------------------------------------------
// Principe : le renderer n'a JAMAIS accès à ipcRenderer, require, process, fs,
// etc. Il n'a accès qu'aux méthodes explicitement listées ci-dessous.
// Contrairement à un passthrough générique (send/on avec un nom de canal
// arbitraire), chaque canal IPC est fixé ici en dur, dans le preload — le
// renderer ne peut pas choisir ou inventer un canal.
//
// pseudoDisponible / connexionSession : utilisées par la page de connexion
// (LoginPage.tsx). connexionSession enregistre le nouvel utilisateur dans le
// MockGatewayRuntime PARTAGÉ côté main (voir main.js) — c'est ce qui permet
// au dashboard de connaître ensuite ce même utilisateur.
//
// allerAuTableauDeBord : appelée une fois la session établie, pour demander
// au processus main de naviguer vers le dashboard (canal
// 'navigation:tableau-de-bord').
//
// obtenirUtilisateurConnecte : utilisée par le dashboard au démarrage pour
// savoir qui vient de se connecter (voir renderer.js), au lieu de coder un
// utilisateur en dur.
//
// Les méthodes salons:* : utilisées par le dashboard (salons/messages), sur
// le même principe d'un canal nommé par besoin métier.
contextBridge.exposeInMainWorld('electronAPI', {
  pseudoDisponible: (pseudo) =>
    ipcRenderer.invoke('session:pseudo-disponible', { pseudo }),
  connexionSession: (utilisateur) =>
    ipcRenderer.invoke('session:connexion', utilisateur),
  obtenirUtilisateurConnecte: () =>
    ipcRenderer.invoke('session:utilisateur-connecte'),
  allerAuTableauDeBord: () => ipcRenderer.invoke('navigation:tableau-de-bord'),

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
});