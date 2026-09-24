// salons/etat.js — Éléments du DOM, état de la page, stockage local, réseau et présence.
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).
//
// UI uniquement : toutes les opérations passent par l'API sécurisée du preload.
//
// Pas de require() ici : nodeIntegration est désactivé (à raison, voir
// main.js) donc ce fichier n'a accès ni à Node ni au module i18n.js utilisé
// par main.js/preload.js.
//
// I18n vient de i18n-browser.js, un script classique chargé avant celui-ci
// (voir index.html) qui expose window.I18n comme global — même pattern que
// NotifPrefs ci-dessous (voir son commentaire pour le garde-fou), et qui
// tient tout l'état i18n (dictionnaire, langue courante/par défaut) et la
// logique de lookup/substitution/traduction d'erreurs en UN SEUL endroit
// partagé avec message-prive.js, plutôt que deux copies à synchroniser à la
// main (voir i18n-browser.js pour le détail complet).
const I18n =
  window.I18n ??
  (() => {
    console.error(
      '[renderer] window.I18n est introuvable : i18n-browser.js doit être chargé avant renderer.js (voir index.html). Traductions désactivées pour cette session (clés brutes affichées).'
    );
    return {
      t: (cle) => cle,
      appliquerTraductionsStatiques: () => {},
      messageErreur: (erreur) =>
        erreur instanceof Error ? erreur.message : String(erreur),
      initialiserDepuisElectronAPI: async () => 'fr',
      obtenirLangue: () => 'fr',
      definirLangueActuelle: () => {},
    };
  })();
const t = I18n.t;
const appliquerTraductionsStatiques = I18n.appliquerTraductionsStatiques;
const messageErreur = I18n.messageErreur;
const ChatUiShared = window.ChatUiShared;
if (!ChatUiShared) {
  throw new Error('chat-ui-shared.js doit être chargé avant renderer.js');
}

// ThemeManager vient de theme-browser.js, même pattern que I18n ci-dessus
// (script classique chargé avant celui-ci, voir index.html) — un seul
// endroit qui applique data-theme sur <html> et retient le thème courant,
// partagé avec message-prive.js.
const ThemeManager =
  window.ThemeManager ??
  (() => {
    console.error(
      '[renderer] window.ThemeManager est introuvable : theme-browser.js doit être chargé avant renderer.js (voir index.html). Le thème reste bloqué sur sombre pour cette session.'
    );
    return {
      appliquerTheme: () => {},
      obtenirTheme: () => 'sombre',
      initialiserDepuisElectronAPI: async () => 'sombre',
    };
  })();

// NotifPrefs vient de notif-prefs.js, un script classique chargé avant celui-ci
// (voir index.html) qui expose window.NotifPrefs comme global — cette référence
// locale évite les erreurs ESLint no-undef (comme le fait déjà message-prive.js
// avec `const NotifPrefs = window.NotifPrefs;`).
// Garde-fou : si notif-prefs.js n'a pas chargé (ordre des <script> changé par
// erreur dans index.html, échec de chargement, etc.), window.NotifPrefs serait
// `undefined` et le moindre appel plus bas (afficherSalons/afficherMessages,
// sur le chemin de rendu principal) ferait planter toute la page. On dégrade
// plutôt vers un mode "sans notifications" : les ronds et le badge restent
// simplement masqués, mais salons/messages continuent de s'afficher.
const NotifPrefs =
  window.NotifPrefs ??
  (() => {
    console.error(
      '[renderer] window.NotifPrefs est introuvable : notif-prefs.js doit être chargé avant renderer.js (voir index.html). Notifications et badges désactivés pour cette session.'
    );
    return {
      MODE_SYSTEME: 'systeme',
      MODE_DISCRET: 'discret',
      MODE_AUCUNE: 'aucune',
      obtenirMode: () => 'aucune',
      definirMode: () => {},
      afficheRonds: () => false,
      marquerCommeLu: () => {},
      estNonLu: () => false,
      compterSalonsNonLus: () => 0,
      compterConversationsNonLues: () => 0,
      genererIconeBadge: () => null,
      appliquerBadge: () => {},
      traiterMessageRecu: async () => {},
    };
  })();
let utilisateurActuelId = sessionStorage.getItem('currentUserId') ?? null;
// Utilisateur connecté complet ({id, pseudo, courriel, role} | null, voir
// obtenirUtilisateurConnecte dans preload.js) — utilisateurActuelId ci-dessus
// reste dérivé de cette valeur (voir initialiserUtilisateurCourant) pour ne
// rien casser des usages existants qui n'ont besoin que de l'id, mais
// utilisateurActuel sert surtout à l'affichage (pseudo, avatar) : les droits
// de gestion viennent du rôle DANS le serveur actif (voir roleActuel()).
let utilisateurActuel = null;
// Préférences du compte (thème, langue, mode de notification, alias), tenues
// à jour par main.js depuis User-Config-Service — voir appliquerPreferences.
let preferences = null;
let salonActifId = null;
// Serveur affiché, mémorisé d'un lancement à l'autre (best-effort).
const CLEF_SERVEUR_ACTIF = 'chatvardage:serveur-actif';
let serveurActifId = lireStockage(localStorage, CLEF_SERVEUR_ACTIF);
// Serveurs (autres que l'actif) ayant reçu un message depuis qu'on les a
// quittés des yeux : pastille sur leur icône du rail. Partagé avec
// message-prive.js via sessionStorage (même clé).
const CLEF_SERVEURS_NON_LUS = 'chatvardage:serveurs-non-lus';
const serveursNonLus = new Set(
  JSON.parse(lireStockage(sessionStorage, CLEF_SERVEURS_NON_LUS) ?? '[]')
);
// Vrai après le premier actualiser() réussi : avant, le rail reste celui
// affiché depuis le cache (voir ChatUiShared.afficherRailDepuisCache) au lieu
// d'être vidé puis mémorisé vide.
let etatCharge = false;
let etat = {
  utilisateurs: [],
  serveurs: [],
  serveurActif: null,
  salons: [],
  invitations: [],
};

function lireStockage(stockage, clef) {
  try {
    return stockage.getItem(clef);
  } catch {
    return null;
  }
}

function ecrireStockage(stockage, clef, valeur) {
  try {
    if (valeur === null) stockage.removeItem(clef);
    else stockage.setItem(clef, valeur);
  } catch {
    // Best-effort : sans stockage, seul le souvenir est perdu.
  }
}

function memoriserServeursNonLus() {
  ecrireStockage(
    sessionStorage,
    CLEF_SERVEURS_NON_LUS,
    JSON.stringify([...serveursNonLus])
  );
}

/** Rôle de l'utilisateur dans le serveur affiché (null : aperçu). */
function roleActuel() {
  return etat.serveurActif?.monRole ?? null;
}
let presences = {};
// 'inconnu' tant que main.js n'a pas répondu : l'indicateur reste masqué
// (voir .connection-status[data-state='inconnu'] dans styles.css).
let etatReseau = { statut: 'inconnu', reconnexions: 0 };
// Miroir côté renderer de fenetreEstFocusee dans main.js (voir
// 'window:focus-changed' / 'window:is-focused' dans preload.js), initialisé
// à `true` par défaut le temps que la vraie valeur arrive (voir plus bas où
// on l'interroge dès le démarrage) : la fenêtre vient tout juste d'être
// affichée à ce moment-là, donc `true` est la meilleure hypothèse de départ.
// Sert uniquement à décider si la conversation actuellement affichée doit
// être marquée "lue" (voir afficherMessages()) — main.js gère déjà son
// propre état équivalent pour décider d'afficher ou non une notification
// système, les deux doivent rester d'accord (voir le commentaire dans
// afficherMessages()).
let fenetreEstFocusee = true;

const el = {
  salons: document.querySelector('#channel-list'),
  messages: document.querySelector('#message-list'),
  nomSalon: document.querySelector('#active-channel-name'),
  prive: document.querySelector('#private-indicator'),
  formulaire: document.querySelector('#message-form'),
  message: document.querySelector('#message-input'),
  inviter: document.querySelector('#open-invite-user'),
  membres: document.querySelector('#open-members'),
  creer: document.querySelector('#open-create-channel'),
  creerRail: document.querySelector('#open-create-channel-rail'),
  rail: document.querySelector('#server-rail'),
  menuServeur: document.querySelector('#server-menu-btn'),
  nomServeur: document.querySelector('#server-name'),
  invitations: document.querySelector('#open-invitations'),
  compteur: document.querySelector('#invitation-count'),
  utilisateurPseudo: document.querySelector('#current-user-pseudo'),
  utilisateurRoleBadge: document.querySelector('#current-user-role-badge'),
  logout: document.querySelector('#logout-btn'),
  profil: document.querySelector('#open-profile'),
  roomSettings: document.querySelector('#open-room-settings'),
  dialogue: document.querySelector('#app-dialog'),
  titreDialogue: document.querySelector('#dialog-title'),
  contenuDialogue: document.querySelector('#dialog-content'),
  toast: document.querySelector('#toast'),
  statutConnexion: document.querySelector('#connection-status'),
  libelleConnexion: document.querySelector('#connection-label'),
  detailConnexion: document.querySelector('#connection-detail'),
  reessayerConnexion: document.querySelector('#connection-retry'),
  avatarCourant: document.querySelector('#current-user-avatar'),
  envoyer: document.querySelector('#message-form button[type="submit"]'),
};

function afficherEtatReseau(nouvelEtat = etatReseau) {
  etatReseau = nouvelEtat ?? etatReseau;
  ChatUiShared.afficherEtatReseau({
    etat: etatReseau,
    elements: {
      statutConnexion: el.statutConnexion,
      libelleConnexion: el.libelleConnexion,
      detailConnexion: el.detailConnexion,
      reessayer: el.reessayerConnexion,
      messageInput: el.message,
      submitButton: el.envoyer,
    },
    t,
    // Salon lisible mais en écriture réservée (ex. #annonces) : champ
    // désactivé, voir aussi le placeholder dans afficherMessages().
    composerAutorise: Boolean(salonActif()?.peutEcrire),
  });
  // La pastille de l'avatar dépend aussi de l'état réseau.
  afficherPresenceCourante();
}

function afficherPresenceCourante() {
  ChatUiShared.afficherAvatarCourant({
    element: el.avatarCourant,
    utilisateur: utilisateurActuel,
    preferences,
    presences,
    etatReseau,
    t,
  });
}

async function chargerEtatReseauEtPresences() {
  await ChatUiShared.chargerEtatReseauEtPresences({
    api: window.electronAPI,
    onEtat: (reseau) => {
      etatReseau = reseau;
    },
    onPresences: (recues) => {
      presences = recues;
    },
  });
  afficherEtatReseau();
  afficherPresenceCourante();
}

const salonActif = () => etat.salons.find((salon) => salon.id === salonActifId);
const utilisateur = (id) => etat.utilisateurs.find((item) => item.id === id);

