// Processus main d'Electron, découpé en modules (voir main.js et
// A26_5A6_01-Infra/docs/architecture-frontend.md). Session (connexion, déconnexion) et relais des événements du gateway.
const { etat, MODE_NOTIFICATION_PAR_DEFAUT } = require('./contexte');
const { chatGateway } = require('./gateway');
const { exposerCanal } = require('./securite');
const { afficherPageConnexion } = require('./fenetre');
const {
  apresOuvertureSession,
  apresOuvertureSessionAvecLangueChoisie,
} = require('./preferences');

// --- Session (écran de connexion) -------------------------------------------
// chatGateway est une INSTANCE UNIQUE, partagée par la page de connexion et
// le dashboard (contrairement à une instance par renderer, qui perdrait
// l'utilisateur créé dès la navigation vers le dashboard — voir l'incident
// "connecté en tant qu'alice par défaut"). C'est pour ça que ces canaux
// vivent ici, dans le même fichier que les canaux 'salons:*'.
//
// Authentification par pseudo OU courriel + mot de passe (voir
// AuthGateway.ts / RealGatewayRuntime.authentifier pour le contrat complet).
exposerCanal('session:authentifier', ({ identifiant, motDePasse }) =>
  chatGateway
    .authentifier({ identifiant, motDePasse })
    .then(
      apresOuvertureSessionAvecLangueChoisie(etat.langueChoisieAvantConnexion)
    )
);
// Écran d'inscription (courriel + mot de passe, pseudo par défaut généré
// côté renderer — voir genererPseudoParDefaut — et transmis ici ; le pseudo
// choisi ici n'est qu'un point de départ, modifiable ensuite sur l'écran
// "Choisis ton pseudo" ou la page profil).
exposerCanal('session:inscription', ({ courriel, motDePasse, pseudo }) =>
  chatGateway
    .inscrire({ courriel, motDePasse, pseudo })
    .then(
      apresOuvertureSessionAvecLangueChoisie(etat.langueChoisieAvantConnexion)
    )
);
// Reprend une session déjà ouverte lors d'un lancement précédent (jeton
// persisté sur disque), appelé par la page de connexion au démarrage pour
// sauter directement au tableau de bord si possible.
exposerCanal('session:restaurer', () =>
  chatGateway.restaurerSession().then(apresOuvertureSession)
);
// Déconnexion explicite (voir page profil) : ferme le socket, efface le
// jeton en mémoire et sur disque.
/** Préférences propres au compte : on ne les laisse pas fuiter vers le
 * compte suivant. Thème et langue restent tels quels (écran de connexion). */
function oublierPreferencesDuCompte() {
  etat.modeNotificationActuel = MODE_NOTIFICATION_PAR_DEFAUT;
  etat.aliasActuel = null;
  etat.avatarActuel = null;
}

exposerCanal('session:deconnexion', async () => {
  await chatGateway.deconnexion();
  oublierPreferencesDuCompte();
  etat.cibleNavigation = null;
});
exposerCanal('session:deconnexion-partout', async () => {
  await chatGateway.deconnexionPartout();
  oublierPreferencesDuCompte();
  etat.cibleNavigation = null;
});
exposerCanal('navigation:motif-retour-connexion', () => {
  const motif = etat.motifRetourConnexion;
  etat.motifRetourConnexion = null;
  return motif;
});
// Utilisé par le dashboard au démarrage pour savoir qui vient de se
// connecter, au lieu de coder un utilisateur en dur (voir renderer.js).
exposerCanal('session:utilisateur-connecte', () =>
  chatGateway.obtenirUtilisateurConnecte()
);

// Le runtime émet les transitions avant même que l'appel IPC de reconnexion
// soit terminé, ce qui permet à l'UI d'afficher réellement « Reconnexion ».
// Jeton expiré ou révoqué en cours d'utilisation (voir
// RealGatewayRuntime.verifierSessionApres401) : la session est déjà fermée
// côté gateway ; on ramène l'app à l'écran de connexion, qui explique
// pourquoi (motifRetourConnexion).
chatGateway.on('session-expiree', () => {
  oublierPreferencesDuCompte();
  etat.cibleNavigation = null;
  etat.motifRetourConnexion = 'session-expiree';
  afficherPageConnexion();
});

chatGateway.on('etat-connexion', (etatConnexion) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('reseau:etat-change', etatConnexion);
  }
});
// Avatar ou alias d'autres utilisateurs modifié (voir
// chargerProfilsPublics) : les pages redessinent les photos concernées.
chatGateway.on('profils-publics', (ids) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('utilisateurs:profils-change', ids);
  }
});
// Changement dans un serveur (membres, salons, invitation, expulsion…),
// signalé en temps réel : les pages rechargent leur état.
chatGateway.on('serveur-change', (evenement) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('serveurs:change', evenement);
  }
});
chatGateway.on('presence', (presence) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('presence:change', presence);
  }
});
chatGateway.on('message-modifie', (message) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('messages:modifie-change', message);
  }
});
chatGateway.on('message-supprime', (message) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('messages:supprime-change', message);
  }
});
// Nouveau message reçu en temps réel (salon ou DM), poussé par le WebSocket
// Serveur-API. Voir javascript/salons/temps-reel.js et
// message-prive.js pour le traitement (ajout à la conversation affichée,
// notification système si hors focus).
chatGateway.on('message-recu', (payload) => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('messages:nouveau', payload);
  }
});

chatGateway.on('synchronisation-requise', () => {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send('reseau:synchronisation-requise');
  }
});
