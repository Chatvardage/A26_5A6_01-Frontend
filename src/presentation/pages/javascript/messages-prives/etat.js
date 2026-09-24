// messages-prives/etat.js — Dépendances (I18n, ChatUiShared…), éléments du DOM,
// réseau, présence, notifications et état de la page.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

// Pas de require() ici : nodeIntegration est désactivé, comme pour
// renderer.js (voir son commentaire équivalent en tête de fichier pour le
// pourquoi complet).
//
// I18n vient de i18n-browser.js, un script classique chargé avant celui-ci
// (voir message-prive.html) qui expose window.I18n comme global — même
// pattern que window.NotifPrefs (voir le garde-fou plus bas dans ce
// fichier), et qui tient tout l'état i18n (dictionnaire, langue
// courante/par défaut) et la logique de lookup/substitution/traduction
// d'erreurs en UN SEUL endroit partagé avec renderer.js, plutôt que deux
// copies à synchroniser à la main (voir i18n-browser.js pour le détail
// complet).
const I18n =
  window.I18n ??
  (() => {
    console.error(
      '[message-prive] window.I18n est introuvable : i18n-browser.js doit être chargé avant ce script (voir message-prive.html). Traductions désactivées pour cette session (clés brutes affichées).'
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
const ChatUiShared = window.ChatUiShared;
if (!ChatUiShared) {
  throw new Error('chat-ui-shared.js doit être chargé avant messages-prives/etat.js');
}
const LogiqueInterface = window.LogiqueInterface;
if (!LogiqueInterface) {
  throw new Error(
    'logique-interface.js doit être chargé avant messages-prives/etat.js'
  );
}

// ThemeManager vient de theme-browser.js, même pattern que I18n ci-dessus.
const ThemeManager =
  window.ThemeManager ??
  (() => {
    console.error(
      '[message-prive] window.ThemeManager est introuvable : theme-browser.js doit être chargé avant ce script (voir message-prive.html). Le thème reste bloqué sur sombre pour cette session.'
    );
    return {
      appliquerTheme: () => {},
      obtenirTheme: () => 'sombre',
      initialiserDepuisElectronAPI: async () => 'sombre',
    };
  })();

// Icône de main qui salue, en remplacement de l'emoji 👋 : voir le
// commentaire équivalent (et le même SVG) dans renderer.js — l'emoji ne
// s'affiche pas de façon fiable dans Electron selon les polices installées
// sur le système (tofu box), un SVG inline s'affiche toujours.
function creerIconeMain() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icone-main');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const groupe = document.createElementNS(NS, 'g');
  groupe.setAttribute('fill', 'currentColor');
  const paume = document.createElementNS(NS, 'circle');
  paume.setAttribute('cx', '8');
  paume.setAttribute('cy', '10');
  paume.setAttribute('r', '4');
  groupe.appendChild(paume);
  for (const angle of [-30, -10, 10, 30]) {
    const doigt = document.createElementNS(NS, 'rect');
    doigt.setAttribute('x', '-1');
    doigt.setAttribute('y', '-6');
    doigt.setAttribute('width', '2');
    doigt.setAttribute('height', '5');
    doigt.setAttribute('rx', '1');
    doigt.setAttribute('transform', `translate(8 6) rotate(${angle})`);
    groupe.appendChild(doigt);
  }
  svg.appendChild(groupe);
  return svg;
}

// Voir EMOJI_VERS_ICONE/remplirTexteMessage dans renderer.js : même table et
// même logique, dupliquées ici faute de système de module partagé entre les
// deux scripts (voir le commentaire en tête de fichier sur nodeIntegration).
const EMOJI_VERS_ICONE = { '👋': creerIconeMain };

function remplirTexteMessage(element, texte) {
  element.replaceChildren();
  const emojiConnus = Object.keys(EMOJI_VERS_ICONE);
  const decoupage = new RegExp(`(${emojiConnus.join('|')})`, 'gu');
  for (const segment of texte.split(decoupage)) {
    if (!segment) continue;
    const creerIcone = EMOJI_VERS_ICONE[segment];
    element.appendChild(
      creerIcone ? creerIcone() : document.createTextNode(segment)
    );
  }
}

const listElement = document.getElementById('conversation-list');
const messageList = document.getElementById('message-list');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const topbarName = document.querySelector('.user-name');
const topbarStatus = document.querySelector('.user-status');
const topbarAvatar = document.querySelector('.topbar-avatar');
const typingIndicator = document.getElementById('typing-indicator');
const filterButtons = document.querySelectorAll('.filter-button');
// Affichage en lecture seule de l'utilisateur réellement connecté, plus un vrai bouton
// de déconnexion et un accès à la page profil.
const currentUserPseudoEl = document.getElementById('current-user-pseudo');
const currentUserRoleBadgeEl = document.getElementById(
  'current-user-role-badge'
);
const profilBtn = document.getElementById('open-profile');
const logoutBtn = document.getElementById('logout-btn');
const openNewDmBtn = document.getElementById('open-new-dm');
const dmDialog = document.getElementById('dm-dialog');
const dmDialogContent = document.getElementById('dialog-content');
const toastElement = document.getElementById('toast');
const notifBtn = document.getElementById('open-notif-settings');
const notifMenu = document.getElementById('notif-menu');
const isTypingNom = document.getElementById('is-typing-nom');
const connectionStatus = document.getElementById('connection-status');
const connectionLabel = document.getElementById('connection-label');
const connectionDetail = document.getElementById('connection-detail');
const connectionRetry = document.getElementById('connection-retry');
const currentUserAvatar = document.getElementById('current-user-avatar');

// 'inconnu' tant que main.js n'a pas répondu, voir renderer.js.
let etatReseau = { statut: 'inconnu' };
let presences = {};

function afficherEtatReseau(nouvelEtat = etatReseau) {
  etatReseau = nouvelEtat ?? etatReseau;
  ChatUiShared.afficherEtatReseau({
    etat: etatReseau,
    elements: {
      statutConnexion: connectionStatus,
      libelleConnexion: connectionLabel,
      detailConnexion: connectionDetail,
      reessayer: connectionRetry,
      messageInput,
      submitButton: messageForm?.querySelector('button[type="submit"]'),
    },
    t,
    composerAutorise: Boolean(
      state.activeConversationId &&
      state.conversations.some(
        (conversation) => conversation.id === state.activeConversationId
      )
    ),
  });
  // La pastille de l'avatar dépend aussi de l'état réseau.
  afficherPresenceCourante();
}

function afficherPresenceCourante() {
  ChatUiShared.afficherAvatarCourant({
    element: currentUserAvatar,
    utilisateur: state.utilisateurActuel,
    preferences: state.preferences,
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

// window.NotifPrefs vient de notif-prefs.js, un script classique chargé
// avant ce module (voir message-prive.html) — voir ce fichier pour le
// pourquoi du partage entre les deux pages plutôt qu'une réimplémentation
// locale.
// Garde-fou : si notif-prefs.js n'a pas chargé (ordre des <script> changé
// par erreur dans message-prive.html, échec de chargement, etc.), on
// dégrade vers un mode "sans notifications" plutôt que de faire planter le
// rendu des conversations (voir le même garde-fou dans renderer.js).
const NotifPrefs =
  window.NotifPrefs ??
  (() => {
    console.error(
      '[message-prive] window.NotifPrefs est introuvable : notif-prefs.js doit être chargé avant ce script (voir message-prive.html). Notifications et badges désactivés pour cette session.'
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
const serviceNotifications = window.notifications;

// Miroir de fenetreEstFocusee côté main.js (voir 'window:is-focused' /
// 'window:focus-changed' dans preload.js) : sert uniquement à décider si
// la conversation actuellement affichée doit être marquée "lue" (voir
// renderActiveConversation() plus bas) — même raisonnement que dans
// renderer.js (voir son commentaire équivalent pour le pourquoi).
let fenetreEstFocusee = true;

function definirConversationActivePourNotifs(conversationId) {
  if (typeof serviceNotifications?.setActiveConversation === 'function') {
    serviceNotifications.setActiveConversation(conversationId ?? null);
  }
}

function notifierMessageSysteme(message) {
  if (typeof serviceNotifications?.messageReceived === 'function' && message) {
    serviceNotifications.messageReceived(message);
  }
}

// Mêmes clés que renderer.js (voir son commentaire équivalent) : servent à
// transmettre, à travers une navigation entre les deux pages, la
// conversation à ouvrir tout de suite après le chargement suite au clic
// sur une notification.
const CLEF_CIBLE_DM = 'notif:cible-dm';
const CLEF_CIBLE_SALON = 'notif:cible-salon';

const state = {
  conversations: [],
  activeConversationId: null,
  currentFilter: 'all',
  preferences: null,
  currentUserId: null,
  // Utilisateur connecté complet ({id, pseudo, courriel, role} | null, voir
  // obtenirUtilisateurConnecte dans preload.js) — state.currentUserId
  // reste dérivé de cette valeur pour ne rien casser des usages existants
  // qui n'ont besoin que de l'id.
  utilisateurActuel: null,
  utilisateurs: [],
  etatsSaisie: {},
};

/**
 * Affiche l'utilisateur connecté (pseudo en lecture seule + badge de
 * rôle) — voir afficherUtilisateurCourant dans renderer.js pour
 * l'équivalent salon (même logique, dupliquée pour la même raison que le
 * reste de ce fichier, voir son en-tête).
 */
function afficherUtilisateurCourant() {
  if (currentUserPseudoEl) {
    // Alias prioritaire, voir afficherUtilisateurCourant dans renderer.js.
    const pseudo = state.utilisateurActuel?.pseudo ?? '';
    currentUserPseudoEl.textContent = state.preferences?.alias || pseudo;
    currentUserPseudoEl.title = state.preferences?.alias ? `@${pseudo}` : '';
  }
  afficherPresenceCourante();
  if (currentUserRoleBadgeEl) {
    const role = state.utilisateurActuel?.role;
    const cleRole =
      role === 'admin'
        ? 'channels.roleAdmin'
        : role === 'moderateur'
          ? 'channels.roleModerator'
          : null;
    currentUserRoleBadgeEl.hidden = !cleRole;
    currentUserRoleBadgeEl.textContent = cleRole ? t(cleRole) : '';
    currentUserRoleBadgeEl.title = cleRole ? t(cleRole) : '';
  }
}

/** Présence des autres utilisateurs, reçue en temps réel. Appelée une fois, au démarrage (message-prive.js). */
function brancherPresence() {
  window.electronAPI.onPresenceChange((presence) => {
    presences[presence.utilisateurId] = presence.statut;
    afficherPresenceCourante();

    const conversation = state.conversations.find(
      (item) => item.otherUser?.id === presence.utilisateurId
    );
    if (!conversation) return;

    conversation.otherUser.present = presence.statut === 'en-ligne';

    // Les filtres « en ligne » / « hors ligne » dépendent directement de la
    // présence : dans ce cas on reconstruit seulement la liste locale, sans
    // refaire d'appel IPC pour recharger toutes les conversations.
    if (state.currentFilter !== 'all') {
      renderConversationList();
    } else if (listElement) {
      const ligne = Array.from(
        listElement.querySelectorAll('.conversation[data-conversation-id]')
      ).find((element) => element.dataset.conversationId === conversation.id);
      const avatar = ligne?.querySelector('.avatar');
      avatar?.classList.toggle('offline', !conversation.otherUser.present);

      // Le sous-titre affiche la présence uniquement lorsqu'il n'y a encore
      // aucun message dans cette conversation.
      if (!conversation.lastMessage) {
        const sousTitre = ligne?.querySelector('.last-message');
        if (sousTitre) {
          sousTitre.textContent = conversation.otherUser.present
            ? t('dm.online')
            : t('dm.offline');
        }
      }
    }

    if (conversation.id === state.activeConversationId) {
      if (topbarStatus) {
        topbarStatus.textContent = conversation.otherUser.present
          ? t('dm.online')
          : t('dm.offline');
        topbarStatus.classList.toggle('online', conversation.otherUser.present);
        topbarStatus.classList.toggle(
          'offline',
          !conversation.otherUser.present
        );
      }
      topbarAvatar?.classList.toggle(
        'offline',
        !conversation.otherUser.present
      );
    }
  });
}
