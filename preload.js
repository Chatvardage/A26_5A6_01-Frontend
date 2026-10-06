const { contextBridge, ipcRenderer } = require('electron');

// --- Barre de titre personnalisée ----------------------------------------------
// Hors macOS, la fenêtre n'a pas de cadre (frame: false, voir createWindow
// dans main.js) : on ajoute sur chaque page une bande glissable avec le nom
// de l'app et les boutons réduire/agrandir/fermer. Son style (.app-titlebar)
// vit dans styles.css et connexion.css, qui réservent sa place dès le
// premier affichage (la page ne « saute » donc pas quand elle apparaît).
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONES_FENETRE = {
  reduire: 'M2 6h8',
  agrandir: 'M2.5 2.5h7v7h-7z',
  restaurer: 'M4 2h6v6M2 4h6v6H2z',
  fermer: 'M2.5 2.5l7 7M9.5 2.5l-7 7',
};

function creerIconeFenetre(nom) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const trace = document.createElementNS(SVG_NS, 'path');
  trace.setAttribute('d', ICONES_FENETRE[nom]);
  svg.appendChild(trace);
  return svg;
}

// Libellés des boutons, traduits (section `titlebar` de translations.json)
// dès que la langue est connue ; ces valeurs ne servent qu'en attendant ou si
// la traduction est indisponible.
const LIBELLES_FENETRE_PAR_DEFAUT = {
  reduire: 'Réduire',
  agrandir: 'Agrandir',
  restaurer: 'Restaurer',
  fermer: 'Fermer',
};
const CLES_LIBELLES_FENETRE = {
  reduire: 'minimize',
  agrandir: 'maximize',
  restaurer: 'restore',
  fermer: 'close',
};

async function traduireLibellesFenetre() {
  try {
    const [dictionnaires, langue] = await Promise.all([
      ipcRenderer.invoke('i18n:dictionnaires'),
      ipcRenderer.invoke('langue:obtenir'),
    ]);
    const traductions = dictionnaires?.[langue]?.titlebar ?? {};
    return Object.fromEntries(
      Object.entries(CLES_LIBELLES_FENETRE).map(([nom, cle]) => [
        nom,
        traductions[cle] ?? LIBELLES_FENETRE_PAR_DEFAUT[nom],
      ])
    );
  } catch {
    return LIBELLES_FENETRE_PAR_DEFAUT;
  }
}

function definirLibelle(bouton, libelle) {
  bouton.setAttribute('aria-label', libelle);
  bouton.title = libelle;
}

function creerBoutonFenetre(nom, libelle, canal) {
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = `app-titlebar-btn app-titlebar-btn--${nom}`;
  definirLibelle(bouton, libelle);
  bouton.appendChild(creerIconeFenetre(nom));
  bouton.addEventListener('click', () => ipcRenderer.invoke(canal));
  return bouton;
}

window.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.app-titlebar')) return;
  const barre = document.createElement('div');
  barre.className = 'app-titlebar';
  const titre = document.createElement('span');
  titre.className = 'app-titlebar-title';
  titre.textContent = 'ChatVardage';
  barre.appendChild(titre);

  if (process.platform === 'darwin') {
    document.documentElement.classList.add('platform-darwin');
  } else {
    const boutons = document.createElement('div');
    boutons.className = 'app-titlebar-controls';
    let libelles = LIBELLES_FENETRE_PAR_DEFAUT;
    let maximiseeCourante = false;
    const reduire = creerBoutonFenetre(
      'reduire',
      libelles.reduire,
      'fenetre:reduire'
    );
    const agrandir = creerBoutonFenetre(
      'agrandir',
      libelles.agrandir,
      'fenetre:agrandir'
    );
    const fermer = creerBoutonFenetre(
      'fermer',
      libelles.fermer,
      'fenetre:fermer'
    );
    const afficherMaximisee = (maximisee) => {
      maximiseeCourante = maximisee;
      const etatBouton = maximisee ? 'restaurer' : 'agrandir';
      agrandir.replaceChildren(creerIconeFenetre(etatBouton));
      definirLibelle(agrandir, libelles[etatBouton]);
    };
    traduireLibellesFenetre().then((traduits) => {
      libelles = traduits;
      definirLibelle(reduire, libelles.reduire);
      definirLibelle(fermer, libelles.fermer);
      afficherMaximisee(maximiseeCourante);
    });
    ipcRenderer.on('fenetre:maximisee', (_event, maximisee) =>
      afficherMaximisee(maximisee)
    );
    ipcRenderer
      .invoke('fenetre:est-maximisee')
      .then(afficherMaximisee)
      .catch(() => {});
    boutons.append(reduire, agrandir, fermer);
    barre.appendChild(boutons);
    // Double-clic sur la bande : agrandir/restaurer, comme une barre native.
    barre.addEventListener('dblclick', (event) => {
      if (!event.target.closest('.app-titlebar-controls')) {
        ipcRenderer.invoke('fenetre:agrandir');
      }
    });
  }

  document.body.prepend(barre);
});

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
  // Repli quand le système n'a pas de service de notifications (ex. WSL,
  // voir notifierParRepli dans main.js) : `{ type, conversationId, contenu }`.
  onNotificationRepli: (callback) => {
    const ecouteur = (_event, message) => callback(message);
    ipcRenderer.on('notifications:repli', ecouteur);
    return () => ipcRenderer.removeListener('notifications:repli', ecouteur);
  },
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
  definirMotifRetourConnexion: (motif) =>
    ipcRenderer.invoke('session:definir-motif-retour', { motif }),
  // Invalide aussi les jetons des autres appareils (voir page profil).
  deconnexionPartout: () => ipcRenderer.invoke('session:deconnexion-partout'),
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

  // Préférences du compte (thème, langue, mode de notification, alias),
  // tenues à jour par main.js depuis User-Config-Service et poussées à
  // chaque changement via 'preferences:change'.
  obtenirPreferences: () => ipcRenderer.invoke('preferences:obtenir'),
  modifierPreferences: (donnees) =>
    ipcRenderer.invoke('preferences:modifier', donnees),
  onPreferencesChange: (rappel) => {
    const ecouteur = (_event, preferences) => rappel(preferences);
    ipcRenderer.on('preferences:change', ecouteur);
    return () => ipcRenderer.removeListener('preferences:change', ecouteur);
  },

  obtenirEtatReseau: () => ipcRenderer.invoke('reseau:etat'),
  // "Réessayer maintenant" : saute le délai de la reconnexion automatique.
  reessayerConnexion: () => ipcRenderer.invoke('reseau:reessayer'),
  obtenirPresences: () => ipcRenderer.invoke('presence:obtenir'),
  modifierPresence: (statut) =>
    ipcRenderer.invoke('presence:modifier', { statut }),
  onSynchronisationRequise: (rappel) => {
    const ecouteur = () => rappel();
    ipcRenderer.on('reseau:synchronisation-requise', ecouteur);
    return () =>
      ipcRenderer.removeListener('reseau:synchronisation-requise', ecouteur);
  },
  onEtatReseauChange: (rappel) => {
    const ecouteur = (_event, etat) => rappel(etat);
    ipcRenderer.on('reseau:etat-change', ecouteur);
    return () => ipcRenderer.removeListener('reseau:etat-change', ecouteur);
  },
  // Avatar/alias d'autres utilisateurs modifié : payload = liste d'ids.
  onProfilsPublicsChange: (rappel) => {
    const ecouteur = (_event, ids) => rappel(ids);
    ipcRenderer.on('utilisateurs:profils-change', ecouteur);
    return () =>
      ipcRenderer.removeListener('utilisateurs:profils-change', ecouteur);
  },
  // Changement dans un de mes serveurs : `{ serveurId, raison, cibleId }`
  // (raison : modifie, supprime, membres, expulse, invitation, salons).
  onServeurChange: (rappel) => {
    const ecouteur = (_event, evenement) => rappel(evenement);
    ipcRenderer.on('serveurs:change', ecouteur);
    return () => ipcRenderer.removeListener('serveurs:change', ecouteur);
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
  // Motif d'un retour automatique à l'écran de connexion ('session-expiree'
  // ou null), lu une seule fois (voir main.js).
  obtenirMotifRetourConnexion: () =>
    ipcRenderer.invoke('navigation:motif-retour-connexion'),

  obtenirLangue: () => ipcRenderer.invoke('langue:obtenir'),
  definirLangue: (langue) => ipcRenderer.invoke('langue:definir', { langue }),
  obtenirDictionnairesI18n: () => ipcRenderer.invoke('i18n:dictionnaires'),
  obtenirLangueParDefaut: () => ipcRenderer.invoke('i18n:langue-par-defaut'),

  obtenirTheme: () => ipcRenderer.invoke('theme:obtenir'),
  definirTheme: (theme) => ipcRenderer.invoke('theme:definir', { theme }),
  obtenirThemeParDefaut: () => ipcRenderer.invoke('theme:par-defaut'),

  // État de la page des salons : mes serveurs, le serveur actif (ou celui
  // contenant `salonId`) avec ses salons, mes invitations.
  obtenirEtatSalons: ({ serveurId, salonId } = {}) =>
    ipcRenderer.invoke('salons:etat', { serveurId, salonId }),
  // Pagination "charger plus ancien" de l'historique d'un salon : salons:etat
  // ci-dessus ne renvoie déjà plus que la page de messages la plus récente.
  obtenirMessagesSalonAvant: (donnees) =>
    ipcRenderer.invoke('salons:messages-avant', donnees),

  // Serveurs (Room-Service). Les droits réels sont vérifiés côté serveur.
  obtenirServeurs: () => ipcRenderer.invoke('serveurs:lister'),
  creerServeur: (donnees) => ipcRenderer.invoke('serveurs:creer', donnees),
  modifierServeur: (donnees) =>
    ipcRenderer.invoke('serveurs:modifier', donnees),
  supprimerServeur: (serveurId) =>
    ipcRenderer.invoke('serveurs:supprimer', { serveurId }),
  rejoindreServeur: (serveurId) =>
    ipcRenderer.invoke('serveurs:rejoindre', { serveurId }),
  quitterServeur: (serveurId) =>
    ipcRenderer.invoke('serveurs:quitter', { serveurId }),
  decouvrirServeurs: (texte) =>
    ipcRenderer.invoke('serveurs:decouvrir', { texte }),
  expulserMembre: (donnees) => ipcRenderer.invoke('serveurs:expulser', donnees),
  changerRoleMembre: (donnees) =>
    ipcRenderer.invoke('serveurs:changer-role', donnees),
  inviterAuServeur: (donnees) =>
    ipcRenderer.invoke('serveurs:inviter', donnees),
  // Membres d'un serveur par pages ({ serveurId, decalage? }), et lesquels
  // de `ids` sont déjà membres ({ serveurId, ids }).
  obtenirMembresServeur: (donnees) =>
    ipcRenderer.invoke('serveurs:membres', donnees),
  membresParmi: (donnees) =>
    ipcRenderer.invoke('serveurs:membres-parmi', donnees),
  accepterInvitation: (donnees) =>
    ipcRenderer.invoke('serveurs:accepter-invitation', donnees),
  refuserInvitation: (donnees) =>
    ipcRenderer.invoke('serveurs:refuser-invitation', donnees),

  // Salons d'un serveur : modérateur du serveur minimum.
  creerSalon: (donnees) => ipcRenderer.invoke('salons:creer', donnees),
  modifierSalon: (donnees) => ipcRenderer.invoke('salons:modifier', donnees),
  supprimerSalon: (salonId) =>
    ipcRenderer.invoke('salons:supprimer', { salonId }),
  envoyerMessageSalon: (donnees) =>
    ipcRenderer.invoke('salons:envoyer-message', donnees),
  modifierMessage: (donnees) =>
    ipcRenderer.invoke('messages:modifier', donnees),
  supprimerMessage: (donnees) =>
    ipcRenderer.invoke('messages:supprimer', donnees),
  navigate: (page) => ipcRenderer.invoke('navigate', page),
  // Ce que la page d'arrivée doit ouvrir (voir 'navigation:*-cible' dans
  // src/main/fenetre.js) : { type: 'salon' | 'prive' | 'ajout-serveur', id? }.
  definirCibleNavigation: (cible) =>
    ipcRenderer.invoke('navigation:definir-cible', cible),
  prendreCibleNavigation: (types) =>
    ipcRenderer.invoke('navigation:prendre-cible', { types }),
  obtenirUtilisateurs: () => ipcRenderer.invoke('utilisateurs:lister'),
  // Fenêtre "Nouveau message privé" : suggestions (membres de ses salons,
  // interlocuteurs connus) et recherche par début de pseudo.
  obtenirSuggestionsDm: () => ipcRenderer.invoke('utilisateurs:suggestions-dm'),
  rechercherUtilisateurs: (texte) =>
    ipcRenderer.invoke('utilisateurs:rechercher', { texte }),
  obtenirConversationsPrivees: (utilisateurId) =>
    ipcRenderer.invoke('obtenir-conversations-privees', { utilisateurId }),
  // Pastilles « non lu » : { id, lastMessage } par conversation, en un seul
  // appel réseau (sans l'historique de chaque conversation).
  obtenirResumesConversationsPrivees: () =>
    ipcRenderer.invoke('resumes-conversations-privees'),
  // Pagination "charger plus ancien" de l'historique d'une conversation
  // privée (voir obtenirMessagesPriveesAvant dans RealGatewayRuntime.js) :
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
