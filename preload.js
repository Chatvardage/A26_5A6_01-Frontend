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
  // Badge de messages non lus sur l'icône de l'app (dock macOS/Linux,
  // superposition sur la barre des tâches Windows). `iconDataUrl` est un
  // PNG en dataURL dessiné côté renderer (voir genererIconeBadge dans
  // renderer.js / message-prive.js) : main.js n'a pas accès à <canvas>.
  setBadgeCount: (count, iconDataUrl) =>
    ipcRenderer.invoke('notifications:set-badge-count', { count, iconDataUrl }),
  // État de focus de la fenêtre (voir fenetreEstFocusee dans main.js) :
  // isWindowFocused() donne l'état au moment de l'appel (utile à
  // l'initialisation d'une page, avant qu'un premier événement ait pu être
  // reçu), onFocusChange() abonne à ses changements par la suite. Utilisé
  // pour ne marquer une conversation comme "lue" (NotifPrefs.marquerCommeLu)
  // que si la fenêtre a réellement le focus au moment où elle est affichée.
  isWindowFocused: () => ipcRenderer.invoke('window:is-focused'),
  onFocusChange: (callback) => {
    const ecouteur = (_event, focused) => callback(focused);
    ipcRenderer.on('window:focus-changed', ecouteur);
    return () => ipcRenderer.removeListener('window:focus-changed', ecouteur);
  },
  // Poussé par main.js quand l'utilisatrice clique sur une notification
  // système (voir showMessageNotification) : `{ type: 'salon'|'prive',
  // conversationId }`. Chaque page (renderer.js / message-prive.js) décide
  // d'ouvrir directement la conversation si elle est déjà sur la bonne
  // page, ou de naviguer vers l'autre page en mémorisant la cible.
  onNavigateToConversation: (callback) => {
    const ecouteur = (_event, cible) => callback(cible);
    ipcRenderer.on('notifications:naviguer-vers-conversation', ecouteur);
    return () =>
      ipcRenderer.removeListener(
        'notifications:naviguer-vers-conversation',
        ecouteur
      );
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  // Authentification par pseudo OU courriel + mot de passe — voir
  // AuthGateway.ts / LoginPage.tsx.
  authentifierSession: (identifiant, motDePasse) =>
    ipcRenderer.invoke('session:authentifier', { identifiant, motDePasse }),
  // Écran d'inscription (courriel + mot de passe, pseudo par défaut généré
  // côté renderer) — voir AuthGateway.ts / InscriptionPage.tsx.
  inscriptionSession: (courriel, motDePasse, pseudo) =>
    ipcRenderer.invoke('session:inscription', { courriel, motDePasse, pseudo }),
  // Reprend une session déjà ouverte lors d'un lancement précédent (jeton
  // persisté), appelé au démarrage de la page de connexion.
  restaurerSession: () => ipcRenderer.invoke('session:restaurer'),
  deconnexionSession: () => ipcRenderer.invoke('session:deconnexion'),
  obtenirUtilisateurConnecte: () =>
    ipcRenderer.invoke('session:utilisateur-connecte'),

  // Page profil.
  profilObtenir: () => ipcRenderer.invoke('profil:obtenir'),
  profilModifierPseudo: (pseudo) =>
    ipcRenderer.invoke('profil:modifier-pseudo', { pseudo }),
  profilModifierCompte: (donnees) =>
    ipcRenderer.invoke('profil:modifier-compte', donnees),
  profilSupprimerCompte: (motDePasseActuel) =>
    ipcRenderer.invoke('profil:supprimer-compte', { motDePasseActuel }),

  // Configuration utilisateur (alias, thème, langue, notifications) —
  // User-Config-Service.
  configObtenir: () => ipcRenderer.invoke('config:obtenir'),
  configModifier: (donnees) => ipcRenderer.invoke('config:modifier', donnees),

  obtenirEtatReseau: () => ipcRenderer.invoke('reseau:etat'),
  simulerCoupureReseau: () => ipcRenderer.invoke('reseau:coupure'),
  simulerReconnexionReseau: () => ipcRenderer.invoke('reseau:reconnexion'),
  obtenirPresences: () => ipcRenderer.invoke('presence:obtenir'),
  modifierPresence: (statut) =>
    ipcRenderer.invoke('presence:modifier', { statut }),
  onEtatReseauChange: (rappel) => {
    const ecouteur = (_event, etat) => rappel(etat);
    ipcRenderer.on('reseau:etat-change', ecouteur);
    return () => ipcRenderer.removeListener('reseau:etat-change', ecouteur);
  },
  onPresenceChange: (rappel) => {
    const ecouteur = (_event, presence) => rappel(presence);
    ipcRenderer.on('presence:change', ecouteur);
    return () => ipcRenderer.removeListener('presence:change', ecouteur);
  },
  onMessageModifieChange: (rappel) => {
    const ecouteur = (_event, message) => rappel(message);
    ipcRenderer.on('messages:modifie-change', ecouteur);
    return () =>
      ipcRenderer.removeListener('messages:modifie-change', ecouteur);
  },
  onMessageSupprimeChange: (rappel) => {
    const ecouteur = (_event, message) => rappel(message);
    ipcRenderer.on('messages:supprime-change', ecouteur);
    return () =>
      ipcRenderer.removeListener('messages:supprime-change', ecouteur);
  },
  // Nouveau message reçu en temps réel (salon ou DM) — voir main.js,
  // chatGateway.on('message-recu', ...). Payload :
  // `{ conversationType: 'dm', message }` ou
  // `{ conversationType: 'salon', salonId, message }`.
  onNouveauMessage: (rappel) => {
    const ecouteur = (_event, payload) => rappel(payload);
    ipcRenderer.on('messages:nouveau', ecouteur);
    return () => ipcRenderer.removeListener('messages:nouveau', ecouteur);
  },
  allerAuTableauDeBord: () => ipcRenderer.invoke('navigation:tableau-de-bord'),
  // Symétrique, dans l'autre sens : ramène l'app à l'écran de connexion
  // (voir 'navigation:connexion' dans main.js) — utilisé par le bouton "Se
  // déconnecter" du dashboard/messages privés/profil, après l'appel à
  // deconnexionSession() ci-dessus.
  allerALaConnexion: () => ipcRenderer.invoke('navigation:connexion'),

  obtenirLangue: () => ipcRenderer.invoke('langue:obtenir'),
  definirLangue: (langue) => ipcRenderer.invoke('langue:definir', { langue }),
  obtenirDictionnairesI18n: () => ipcRenderer.invoke('i18n:dictionnaires'),
  obtenirLangueParDefaut: () => ipcRenderer.invoke('i18n:langue-par-defaut'),

  obtenirTheme: () => ipcRenderer.invoke('theme:obtenir'),
  definirTheme: (theme) => ipcRenderer.invoke('theme:definir', { theme }),
  obtenirThemeParDefaut: () => ipcRenderer.invoke('theme:par-defaut'),

  obtenirEtatSalons: (utilisateurId) =>
    ipcRenderer.invoke('salons:etat', { utilisateurId }),
  // Pagination "charger plus ancien" de l'historique d'un salon (voir
  // obtenirMessagesSalonAvant dans MockGatewayRuntime.js) : salons:etat
  // ci-dessus ne renvoie déjà plus que la page de messages la plus récente.
  obtenirMessagesSalonAvant: (donnees) =>
    ipcRenderer.invoke('salons:messages-avant', donnees),
  creerSalon: (donnees) => ipcRenderer.invoke('salons:creer', donnees),
  // Gestion d'un salon (réservée aux modérateurs/admins, voir
  // peutGererSalons côté domaine Utilisateur) : renommer/changer visibilité,
  // supprimer, quitter, retirer un membre.
  modifierSalon: (donnees) => ipcRenderer.invoke('salons:modifier', donnees),
  supprimerSalon: (salonId) =>
    ipcRenderer.invoke('salons:supprimer', { salonId }),
  quitterSalon: (salonId) => ipcRenderer.invoke('salons:quitter', { salonId }),
  retirerMembreSalon: (donnees) =>
    ipcRenderer.invoke('salons:retirer-membre', donnees),
  inviterAuSalon: (donnees) => ipcRenderer.invoke('salons:inviter', donnees),
  accepterInvitation: (donnees) =>
    ipcRenderer.invoke('salons:accepter-invitation', donnees),
  refuserInvitation: (donnees) =>
    ipcRenderer.invoke('salons:refuser-invitation', donnees),
  envoyerMessageSalon: (donnees) =>
    ipcRenderer.invoke('salons:envoyer-message', donnees),
  modifierMessage: (donnees) =>
    ipcRenderer.invoke('messages:modifier', donnees),
  supprimerMessage: (donnees) =>
    ipcRenderer.invoke('messages:supprimer', donnees),
  navigate: (page) => ipcRenderer.invoke('navigate', page),
  obtenirUtilisateurs: () => ipcRenderer.invoke('utilisateurs:lister'),
  obtenirConversationsPrivees: (utilisateurId) =>
    ipcRenderer.invoke('obtenir-conversations-privees', { utilisateurId }),
  // Pagination "charger plus ancien" de l'historique d'une conversation
  // privée (voir obtenirMessagesPriveesAvant dans MockGatewayRuntime.js) :
  // obtenir-conversations-privees ci-dessus ne renvoie déjà plus que la page
  // de messages la plus récente de chaque conversation.
  obtenirMessagesPriveesAvant: (donnees) =>
    ipcRenderer.invoke('obtenir-messages-prive-avant', donnees),
  envoyerMessagePrive: (donnees) =>
    ipcRenderer.invoke('envoyer-message-prive', donnees),
  demarrerConversationPrivee: (donnees) =>
    ipcRenderer.invoke('demarrer-conversation-privee', donnees),
  modifierEtatSaisie: (donnees) =>
    ipcRenderer.invoke('modifier-etat-saisie', donnees),
  obtenirEtatsSaisie: (donnees) =>
    ipcRenderer.invoke('obtenir-etats-saisie', donnees),
});
