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
  throw new Error('chat-ui-shared.js doit être chargé avant message-prive.js');
}

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

window.addEventListener('DOMContentLoaded', async () => {
  const listElement = document.getElementById('conversation-list');
  const messageList = document.getElementById('message-list');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const topbarName = document.querySelector('.user-name');
  const topbarStatus = document.querySelector('.user-status');
  const topbarAvatar = document.querySelector('.topbar-avatar');
  const typingIndicator = document.getElementById('typing-indicator');
  const filterButtons = document.querySelectorAll('.filter-button');
  const currentUserSelect = document.getElementById('current-user-select');
  const langueSelect = document.getElementById('language-select');
  const openNewDmBtn = document.getElementById('open-new-dm');
  const dmDialog = document.getElementById('dm-dialog');
  const dmDialogContent = document.getElementById('dialog-content');
  const toastElement = document.getElementById('toast');
  const notifBtn = document.getElementById('open-notif-settings');
  const notifMenu = document.getElementById('notif-menu');
  const isTypingNom = document.getElementById('is-typing-nom');
  const connectionStatus = document.getElementById('connection-status');
  const connectionLabel = document.getElementById('connection-label');
  const simulateNetworkCut = document.getElementById('simulate-network-cut');
  const simulateNetworkReconnect = document.getElementById(
    'simulate-network-reconnect'
  );
  const currentUserPresence = document.getElementById('current-user-presence');

  let etatReseau = { statut: 'deconnecte' };
  let presences = {};

  function afficherEtatReseau(nouvelEtat = etatReseau) {
    etatReseau = nouvelEtat ?? etatReseau;
    ChatUiShared.afficherEtatReseau({
      etat: etatReseau,
      elements: {
        statutConnexion: connectionStatus,
        libelleConnexion: connectionLabel,
        messageInput,
        submitButton: messageForm?.querySelector('button[type="submit"]'),
        presenceCourante: currentUserPresence,
        couperReseau: simulateNetworkCut,
        reconnecterReseau: simulateNetworkReconnect,
      },
      t,
      composerAutorise: Boolean(
        state.activeConversationId &&
        state.conversations.some(
          (conversation) => conversation.id === state.activeConversationId
        )
      ),
    });
  }

  function afficherPresenceCourante() {
    ChatUiShared.afficherPresenceCourante({
      element: currentUserPresence,
      utilisateurId: state.currentUserId,
      presences,
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

  // Dictionnaire, langue courante et langue par défaut : voir
  // I18n.initialiserDepuisElectronAPI (i18n-browser.js) pour le détail
  // (trois canaux IPC indépendants, lancés en parallèle).
  if (langueSelect) {
    langueSelect.value = await I18n.initialiserDepuisElectronAPI(
      window.electronAPI
    );
  } else {
    await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  }
  appliquerTraductionsStatiques();

  if (langueSelect) {
    langueSelect.addEventListener('change', async (event) => {
      try {
        I18n.definirLangueActuelle(
          await window.electronAPI.definirLangue(event.target.value)
        );
      } catch {
        // Repli silencieux : la langue affichée reste celle d'avant si le
        // canal échoue.
      }
      langueSelect.value = I18n.obtenirLangue();
      appliquerTraductionsStatiques();
      afficherEtatReseau();
      afficherPresenceCourante();
      renderConversationList();
      await renderActiveConversation();
    });
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
        traiterMessageSimule: async () => {},
      };
    })();
  const serviceNotifications = window.notifications;

  // Miroir de fenetreEstFocusee côté main.js (voir 'window:is-focused' /
  // 'window:focus-changed' dans preload.js) : sert uniquement à décider si
  // la conversation actuellement affichée doit être marquée "lue" (voir
  // renderActiveConversation() plus bas) — même raisonnement que dans
  // renderer.js (voir son commentaire équivalent pour le pourquoi).
  let fenetreEstFocusee = true;
  if (typeof serviceNotifications?.isWindowFocused === 'function') {
    fenetreEstFocusee = Boolean(await serviceNotifications.isWindowFocused());
  }
  if (typeof serviceNotifications?.onFocusChange === 'function') {
    serviceNotifications.onFocusChange(async (focused) => {
      const regagneLeFocus = focused && !fenetreEstFocusee;
      fenetreEstFocusee = focused;
      if (regagneLeFocus) {
        // La conversation déjà affichée n'a jamais pu être marquée "lue"
        // pendant qu'elle était en arrière-plan (voir
        // renderActiveConversation()) : on relance l'affichage maintenant
        // qu'elle est effectivement visible.
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
      }
    });
  }

  function definirConversationActivePourNotifs(conversationId) {
    if (typeof serviceNotifications?.setActiveConversation === 'function') {
      serviceNotifications.setActiveConversation(conversationId ?? null);
    }
  }

  function notifierMessageSysteme(message) {
    if (
      typeof serviceNotifications?.messageReceived === 'function' &&
      message
    ) {
      serviceNotifications.messageReceived(message);
    }
  }

  // Mêmes clés que renderer.js (voir son commentaire équivalent) : servent à
  // transmettre, à travers une navigation entre les deux pages, la
  // conversation à ouvrir tout de suite après le chargement suite au clic
  // sur une notification.
  const CLEF_CIBLE_DM = 'notif:cible-dm';
  const CLEF_CIBLE_SALON = 'notif:cible-salon';

  // Clic sur une notification système (voir showMessageNotification dans
  // main.js) : ouvre directement la conversation concernée. Si c'est une
  // conversation privée, on est déjà sur la bonne page ; si c'est un salon,
  // on mémorise la cible et on navigue vers index.html, qui la consommera à
  // son chargement (voir son onNavigateToConversation).
  if (typeof serviceNotifications?.onNavigateToConversation === 'function') {
    serviceNotifications.onNavigateToConversation(async (cible) => {
      const conversationId = cible?.conversationId;
      if (!conversationId) return;
      if (cible.type === 'prive') {
        state.activeConversationId = conversationId;
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
      } else if (cible.type === 'salon') {
        sessionStorage.setItem(CLEF_CIBLE_SALON, conversationId);
        window.electronAPI.navigate('index.html');
      }
    });
  }

  const state = {
    conversations: [],
    activeConversationId: null,
    currentFilter: 'all',
    currentUserId: null,
    utilisateurs: [],
    etatsSaisie: {},
  };
  // Consomme une éventuelle cible laissée par renderer.js avant une
  // navigation vers cette page suite au clic sur une notification de
  // conversation privée (voir onNavigateToConversation ci-dessus et
  // CLEF_CIBLE_DM). Fait avant refreshConversations() plus bas : celui-ci
  // ne fixe activeConversationId sur la première conversation que s'il est
  // encore vide, donc le préremplir ici suffit à faire ouvrir la bonne dès
  // le premier rendu.
  const cibleDm = sessionStorage.getItem(CLEF_CIBLE_DM);
  if (cibleDm) {
    sessionStorage.removeItem(CLEF_CIBLE_DM);
    state.activeConversationId = cibleDm;
  }

  function notifier(message, erreur = false) {
    if (!toastElement) {
      return;
    }
    toastElement.textContent = message;
    toastElement.classList.toggle('error', erreur);
    toastElement.classList.add('visible');
    window.setTimeout(() => toastElement.classList.remove('visible'), 2600);
  }

  // --- Historique et pagination des messages (conversations privées) ------
  // `obtenirConversationsPrivees` (voir refreshConversations()) ne renvoie
  // déjà plus que la page de messages la plus récente de chaque conversation
  // (voir construireConversationPriveeDTO côté MockGatewayRuntime.js) : cet
  // état garde en mémoire, PAR-DESSUS cette page récente, les pages plus
  // anciennes chargées à la demande (voir chargerMessagesPlusAnciensDm) pour
  // la conversation actuellement affichée. Réinitialisé au changement de
  // conversation active (voir renderActiveConversation()), même principe que
  // etatHistoriqueSalon dans renderer.js (voir son commentaire équivalent).
  let etatHistoriqueDm = {
    conversationId: null,
    messagesAnciens: [],
    finHistorique: false,
    enChargement: false,
  };

  // --- Messages non livrés (hors ligne) ------------------------------------
  // Messages tapés pendant que etatReseau.statut !== 'connecte' (ou dont
  // l'envoi a échoué en cours de route) : jamais transmis au gateway, gardés
  // uniquement ici par conversation en attendant que l'utilisateur clique
  // "réessayer" ou "supprimer" (voir creerActionsMessageNonLivre dans
  // chat-ui-shared.js). Voir messagesEnAttenteSalon dans renderer.js pour
  // l'équivalent salon (même raisonnement, y compris le pourquoi de l'absence
  // de persistance dans StockageLocal, et le fait que la Map n'est jamais
  // purgée pour une conversation qu'on ne revisite plus — accepté tel quel).
  const messagesEnAttenteDm = new Map();

  // Ids des messages actuellement en cours de renvoi (voir
  // reessayerMessageEnAttenteDm ci-dessous) — voir
  // messagesEnAttenteEnCoursSalon dans renderer.js pour l'équivalent salon et
  // le détail du pourquoi (anti-double-envoi + empêcher "Supprimer" d'agir
  // pendant qu'un envoi est déjà parti pour ce message).
  const messagesEnAttenteEnCoursDm = new Set();

  function ajouterMessageEnAttenteDm(conversationId, message) {
    const liste = messagesEnAttenteDm.get(conversationId) ?? [];
    liste.push(message);
    messagesEnAttenteDm.set(conversationId, liste);
  }

  // Ne renvoie que les messages en attente de l'utilisateur COURANT (voir
  // obtenirMessagesEnAttenteSalon dans renderer.js pour l'équivalent salon et
  // le pourquoi) : sans ce filtre, changer d'utilisateur simulé ferait
  // apparaître les brouillons non livrés d'un autre utilisateur dans cette
  // même conversation, avec un "Réessayer" qui les enverrait sous son
  // ancien auteurId.
  function obtenirMessagesEnAttenteDm(conversationId) {
    const liste = messagesEnAttenteDm.get(conversationId) ?? [];
    return liste.filter((message) => message.auteurId === state.currentUserId);
  }

  function retirerMessageEnAttenteDm(conversationId, messageId) {
    const liste = messagesEnAttenteDm.get(conversationId);
    if (!liste) return;
    const restants = liste.filter((message) => message.id !== messageId);
    if (restants.length) {
      messagesEnAttenteDm.set(conversationId, restants);
    } else {
      messagesEnAttenteDm.delete(conversationId);
    }
  }

  /**
   * Retente l'envoi d'un message resté "non livré". Vérifie explicitement
   * etatReseau (EtatConnexion) — jamais `presences` : simuler sa propre
   * présence "hors-ligne" (voir brancherControlesReseauPresence) ne doit pas
   * empêcher de réessayer, seule une vraie coupure réseau le doit.
   */
  async function reessayerMessageEnAttenteDm(message) {
    // Garde anti-double-envoi (voir messagesEnAttenteEnCoursDm) : un second
    // clic (ou un second appel) pendant qu'une tentative est déjà en cours
    // pour CE message ne doit rien déclencher de plus.
    if (messagesEnAttenteEnCoursDm.has(message.id)) return;
    if (etatReseau.statut !== 'connecte') {
      notifier(t('messages.stillOffline'), true);
      return;
    }
    messagesEnAttenteEnCoursDm.add(message.id);
    // Réaffiche tout de suite (avant l'await) pour désactiver visuellement
    // les boutons réessayer/supprimer de ce message pendant que la requête
    // est en vol — voir messagesEnAttenteEnCoursDm. conserverPositionScroll
    // évite de faire sauter la vue en bas de la conversation si
    // l'utilisateur avait remonté dans l'historique (voir renderer.js pour
    // l'équivalent salon).
    void renderActiveConversation({ conserverPositionScroll: true });

    // L'envoi et le rafraîchissement de la liste ont chacun leur propre
    // try/catch, volontairement séparés : les regrouper ferait qu'un
    // refreshConversations() en échec APRÈS un envoi réussi tomberait dans
    // le même bloc catch qu'un envoi raté, et serait alors traité comme tel
    // (notification "échec", message remis en attente) — alors que le
    // message est déjà bien parti côté serveur à ce moment-là.
    try {
      await window.electronAPI.envoyerMessagePrive({
        conversationId: message.conversationId,
        contenu: message.contenu,
        utilisateurId: message.auteurId,
      });
    } catch (erreur) {
      // Ici seulement, l'envoi lui-même a échoué : le message reste "non
      // livré" (rien à retirer de messagesEnAttenteDm).
      messagesEnAttenteEnCoursDm.delete(message.id);
      notifier(messageErreur(erreur), true);
      void renderActiveConversation({ conserverPositionScroll: true });
      return;
    }

    // Envoi réussi : retiré de la liste d'attente quoi qu'il arrive au
    // rafraîchissement ci-dessous.
    retirerMessageEnAttenteDm(message.conversationId, message.id);
    messagesEnAttenteEnCoursDm.delete(message.id);
    try {
      await refreshConversations();
    } catch (erreur) {
      // Le message est bien parti ; seul le rechargement de la liste des
      // conversations a échoué ensuite — à ne pas confondre avec un échec
      // d'envoi (pas de remise en attente pour un message déjà livré).
      notifier(messageErreur(erreur), true);
      void renderActiveConversation({ conserverPositionScroll: true });
    }
  }

  function supprimerMessageEnAttenteDm(message) {
    // Refuse de supprimer un message dont l'envoi est actuellement en cours
    // (voir messagesEnAttenteEnCoursDm et reessayerMessageEnAttenteDm) : la
    // requête déjà partie aboutira de toute façon, donc "supprimer" ici ne
    // ferait qu'induire l'utilisateur en erreur sur ce qui a réellement été
    // envoyé.
    if (messagesEnAttenteEnCoursDm.has(message.id)) return;
    retirerMessageEnAttenteDm(message.conversationId, message.id);
    // conserverPositionScroll: true — voir le commentaire équivalent dans
    // reessayerMessageEnAttenteDm ci-dessus (et supprimerMessageEnAttenteSalon
    // dans renderer.js) : sans lui, supprimer un brouillon fait sauter la vue
    // en bas de la conversation même si l'utilisateur lisait plus haut dans
    // l'historique.
    void renderActiveConversation({ conserverPositionScroll: true });
  }

  // Fusionne messages plus anciens déjà remontés et page récente en
  // dédoublonnant par id puis en triant par date d'envoi — voir
  // fusionnerHistorique dans renderer.js pour l'équivalent salon et le détail
  // du pourquoi (chevauchement possible entre les deux listes).
  function fusionnerHistoriqueDm(messagesAnciens, messagesRecents) {
    const parId = new Map();
    [...messagesAnciens, ...messagesRecents].forEach((message) => {
      parId.set(message.id, message);
    });
    return Array.from(parId.values()).sort((a, b) => a.envoi - b.envoi);
  }

  // Construit l'élément affiché en haut de la liste des messages pour
  // représenter l'état de l'historique — voir creerStatutHistorique dans
  // renderer.js pour l'équivalent salon (même comportement : chargement en
  // cours, historique épuisé, ou bouton "charger plus ancien").
  function creerStatutHistoriqueDm(etatHistorique, surClicChargerPlus) {
    const div = document.createElement(
      etatHistorique.enChargement || etatHistorique.finHistorique
        ? 'div'
        : 'button'
    );
    div.classList.add('historique-statut');
    if (etatHistorique.enChargement) {
      div.classList.add('historique-statut--chargement');
      div.textContent = t('history.loading');
      div.setAttribute('aria-live', 'polite');
    } else if (etatHistorique.finHistorique) {
      div.classList.add('historique-statut--fin');
      div.textContent = t('history.endOfHistory');
    } else {
      div.classList.add('historique-statut--bouton');
      div.type = 'button';
      div.textContent = t('history.loadOlder');
      div.addEventListener('click', surClicChargerPlus);
    }
    return div;
  }

  // messageErreur vient de I18n (i18n-browser.js, voir le garde-fou en tête
  // de fichier) — logique partagée avec renderer.js, voir son commentaire
  // pour le détail (prefix IPC, code d'erreur, repli sur le texte brut).
  const messageErreur = I18n.messageErreur;

  function getFilteredConversations() {
    if (state.currentFilter === 'online') {
      return state.conversations.filter(
        (conversation) => conversation.otherUser?.present === true
      );
    }

    return state.conversations;
  }

  setInterval(async () => {
    await actualiserIndicateurSaisie();
  }, 1500);

  async function actualiserIndicateurSaisie() {
    if (!state.activeConversationId) {
      if (typingIndicator) {
        typingIndicator.hidden = true;
        typingIndicator.style.setProperty('display', 'none', 'important');
      }
      return;
    }

    const etats = await window.electronAPI.obtenirEtatsSaisie(
      state.activeConversationId
    );
    state.etatsSaisie = Array.isArray(etats) ? etats : [];

    const autreUtilisateurEcrit = (state.etatsSaisie || []).some(
      (item) =>
        item.utilisateurId !== state.currentUserId && item.est_saisie === true
    );

    if (typingIndicator) {
      if (autreUtilisateurEcrit) {
        typingIndicator.hidden = false;
        typingIndicator.style.setProperty('display', 'flex', 'important');
      } else {
        typingIndicator.hidden = true;
        typingIndicator.style.setProperty('display', 'none', 'important');
      }
    }
  }

  async function refreshConversations(options = {}) {
    const conversations = await window.electronAPI.obtenirConversationsPrivees(
      state.currentUserId
    );
    state.conversations = [...conversations].sort((a, b) => {
      const aTime = a.lastMessage?.envoi ?? a.messages?.[0]?.envoi ?? 0;
      const bTime = b.lastMessage?.envoi ?? b.messages?.[0]?.envoi ?? 0;
      return bTime - aTime;
    });

    if (!state.activeConversationId && state.conversations.length > 0) {
      state.activeConversationId = state.conversations[0].id;
    }

    state.etatsSaisie = await window.electronAPI.obtenirEtatsSaisie(
      state.activeConversationId
    );

    if (
      state.currentFilter === 'online' &&
      !state.conversations.some(
        (conversation) =>
          conversation.id === state.activeConversationId &&
          conversation.otherUser?.present
      )
    ) {
      const firstOnline = state.conversations.find(
        (conversation) => conversation.otherUser?.present
      );
      state.activeConversationId = firstOnline?.id ?? null;
    }

    // state.activeConversationId vient tout juste d'être fixé (ou confirmé)
    // ci-dessus : on rappelle explicitement afficherEtatReseau() ici, car
    // composerAutorise (voir sa définition plus haut) est calculé à partir de
    // cette valeur. Sans cet appel, le chargerEtatReseauEtPresences() du
    // démarrage (voir l'initialisation en bas de fichier) a déjà figé
    // messageInput/submitButton sur `disabled = true` (aucune conversation
    // active à ce moment-là, avant le tout premier refreshConversations()),
    // et rien ne les réactivait plus jamais ensuite.
    afficherEtatReseau();

    // renderActiveConversation() doit s'exécuter avant renderConversationList() :
    // c'est elle qui marque la conversation active comme "lue"
    // (NotifPrefs.marquerCommeLu). Si renderConversationList() tournait en
    // premier, le rond de notification de cette conversation serait calculé
    // avec l'ancien état (non lu) et ne disparaîtrait qu'au prochain
    // rafraîchissement.
    await renderActiveConversation(options);
    renderConversationList();
    mettreAJourBadgeApplication();
    actualiserIndicateurSaisie();
  }

  async function initialiserUtilisateurCourant() {
    const utilisateurs = await window.electronAPI.obtenirUtilisateurs();
    state.utilisateurs = utilisateurs;
    if (currentUserSelect) {
      currentUserSelect.innerHTML = '';
      utilisateurs.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.pseudo;
        currentUserSelect.appendChild(option);
      });
      currentUserSelect.addEventListener('change', async (event) => {
        sessionStorage.setItem('currentUserId', event.target.value);
        state.currentUserId = event.target.value;
        afficherPresenceCourante();
        if (messageInput) messageInput.value = '';
        fermerMenuNotif();
        await refreshConversations();
        await actualiserBadgeSalons();
        await actualiserIndicateurSaisie();
      });
    }
    const selectedUserId = sessionStorage.getItem('currentUserId');
    let utilisateurResolu = utilisateurs.find(
      (u) => u.id === selectedUserId
    )?.id;

    if (!utilisateurResolu) {
      // sessionStorage ne survit pas forcément à la navigation entre deux
      // pages file:// distinctes (index.html -> message-prive.html) — même
      // incident que "connecté en tant qu'alice par défaut" déjà rencontré
      // sur index.html (voir renderer.js, initialiserUtilisateurCourant, et
      // session:utilisateur-connecte dans main.js), qui applique déjà ce
      // même repli. Sans lui, cette page retombe systématiquement sur le
      // premier utilisateur de la liste plutôt que la personne réellement
      // connectée.
      utilisateurResolu = await window.electronAPI.obtenirUtilisateurConnecte();
    }

    state.currentUserId =
      utilisateurs.find((u) => u.id === utilisateurResolu)?.id ??
      utilisateurs[0]?.id ??
      'u1';
    sessionStorage.setItem('currentUserId', state.currentUserId);
    if (currentUserSelect) {
      currentUserSelect.value = state.currentUserId;
    }
  }

  function renderConversationList() {
    if (!listElement) {
      return;
    }

    const filtered = getFilteredConversations();
    listElement.innerHTML = '';

    const afficherRonds = NotifPrefs.afficheRonds(state.currentUserId);

    filtered.forEach((conversation) => {
      const li = document.createElement('li');
      const otherUser = conversation.otherUser;
      const isActive = conversation.id === state.activeConversationId;
      const lastMessage =
        conversation.lastMessage?.contenu ?? t('dm.noMessage');
      const statusLabel = otherUser?.present ? t('dm.online') : t('dm.offline');
      const subtitle = conversation.lastMessage ? lastMessage : statusLabel;

      li.classList.add('conversation');
      li.classList.toggle('active', isActive);
      li.dataset.conversationId = conversation.id;

      const avatar = document.createElement('div');
      avatar.classList.add('avatar');
      if (!otherUser?.present) {
        avatar.classList.add('offline');
      }

      const nonLu =
        afficherRonds &&
        NotifPrefs.estNonLu(
          state.currentUserId,
          conversation.id,
          conversation.lastMessage
            ? {
                auteurId: conversation.lastMessage.auteurId,
                timestamp: conversation.lastMessage.envoi,
              }
            : null
        );
      const dot = document.createElement('span');
      dot.classList.add('notif-dot', 'notif-dot--avatar');
      dot.hidden = !nonLu;
      avatar.appendChild(dot);

      const info = document.createElement('div');
      info.classList.add('conversation-info');

      const username = document.createElement('div');
      username.classList.add('username');
      username.textContent = otherUser?.pseudo ?? t('dm.defaultUser');

      const lastMessageEl = document.createElement('div');
      lastMessageEl.classList.add('last-message');
      lastMessageEl.textContent = subtitle;

      info.append(username, lastMessageEl);
      li.append(avatar, info);

      li.addEventListener('click', async () => {
        state.activeConversationId = conversation.id;
        if (messageInput) messageInput.value = '';
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
        await actualiserIndicateurSaisie();
      });

      listElement.appendChild(li);
    });
  }

  function reinitialiserHistoriqueDm() {
    etatHistoriqueDm = {
      conversationId: null,
      messagesAnciens: [],
      finHistorique: false,
      enChargement: false,
    };
  }

  async function renderActiveConversation(options = {}) {
    const { conserverPositionScroll = false } = options;
    if (!state.activeConversationId) {
      if (messageList) {
        messageList.innerHTML = '';
      }
      definirConversationActivePourNotifs(null);
      reinitialiserHistoriqueDm();
      // composerAutorise (voir afficherEtatReseau) est calculé à partir de
      // state.activeConversationId : sans ce rappel, un composer resterait
      // activé alors qu'il n'y a plus de conversation active pour recevoir
      // le message tapé.
      afficherEtatReseau();
      return;
    }

    const conversation = state.conversations.find(
      (entry) => entry.id === state.activeConversationId
    );

    if (!conversation || !messageList) {
      // `activeConversationId` pointe vers une conversation qui n'existe
      // plus pour l'utilisateur courant (ex. changement d'utilisateur
      // simulé vers quelqu'un qui n'a pas ce DM) : on ne laisse pas
      // l'ancienne conversation affichée sous le nouvel utilisateur, et on
      // arrête de la considérer comme "active" pour les notifications.
      state.activeConversationId = null;
      if (messageList) {
        messageList.innerHTML = '';
      }
      definirConversationActivePourNotifs(null);
      reinitialiserHistoriqueDm();
      // Voir le commentaire équivalent plus haut : activeConversationId
      // vient d'être remis à null, composerAutorise doit être recalculé en
      // conséquence.
      afficherEtatReseau();
      return;
    }

    // On rappelle explicitement afficherEtatReseau() ici : composerAutorise
    // (voir sa définition plus haut) est calculé à partir de
    // state.activeConversationId, qui vient potentiellement d'être fixé par
    // un appelant qui ne passe PAS par refreshConversations() (ex. un clic
    // direct sur une conversation dans la liste, ou un changement de filtre
    // — voir leurs listeners plus bas) — refreshConversations() rappelle
    // bien afficherEtatReseau() de son côté, mais ces deux-là appellent
    // renderActiveConversation() directement. Sans cet appel ici,
    // composerAutorise resterait figé sur sa dernière valeur connue (par ex.
    // désactivé s'il n'y avait provisoirement aucune conversation active),
    // même après qu'une conversation valide soit redevenue active — voir
    // afficherEtatReseau() dans renderer.js (afficherMessages()) pour
    // l'équivalent salon et le même raisonnement.
    afficherEtatReseau();

    // Changement de conversation active : on repart d'un historique manuel
    // vide (voir chargerMessagesPlusAnciensDm et reinitialiserHistoriqueDm).
    // `finHistorique` part de la page récente tout juste reçue
    // (conversation.finHistorique, voir construireConversationPriveeDTO côté
    // MockGatewayRuntime.js) — même logique que etatHistoriqueSalon dans
    // renderer.js (voir son commentaire équivalent).
    if (etatHistoriqueDm.conversationId !== conversation.id) {
      etatHistoriqueDm = {
        conversationId: conversation.id,
        messagesAnciens: [],
        finHistorique: Boolean(conversation.finHistorique),
        enChargement: false,
      };
    } else if (etatHistoriqueDm.messagesAnciens.length === 0) {
      etatHistoriqueDm.finHistorique = Boolean(conversation.finHistorique);
    }

    // La conversation affichée est "lue" — mais SEULEMENT si la fenêtre a
    // effectivement le focus en ce moment (fenetreEstFocusee) : voir le
    // commentaire équivalent dans renderer.js (afficherMessages()) pour le
    // pourquoi (sinon ce rond de notification et la vraie notification
    // système de main.js, qui exige déjà le focus pour la même décision,
    // finissent en désaccord).
    if (fenetreEstFocusee) {
      NotifPrefs.marquerCommeLu(
        state.currentUserId,
        conversation.id,
        Date.now()
      );
    }
    // La conversation "active" que main.js ne doit pas notifier (voir
    // showMessageNotification côté main.js) reste définie qu'on ait le
    // focus ou non : c'est elle qui est affichée à l'écran.
    definirConversationActivePourNotifs(conversation.id);

    // Page récente (conversation.messages) + historique manuellement remonté
    // (voir chargerMessagesPlusAnciensDm) : voir fusionnerHistoriqueDm plus
    // haut. Les messages non livrés de cette conversation (voir
    // messagesEnAttenteDm) sont fusionnés puis triés avec le reste par
    // `envoi` plutôt que simplement ajoutés à la suite : ils ne sont PAS
    // garantis d'être les plus récents — voir le commentaire équivalent sur
    // tousLesMessages dans renderer.js pour le détail du pourquoi (un
    // message réel plus récent peut arriver via refreshConversations()
    // pendant qu'un brouillon plus ancien attend encore, ou deux brouillons
    // peuvent être retentés dans le désordre).
    const messagesEnAttenteDeLaConversation = obtenirMessagesEnAttenteDm(
      conversation.id
    );
    const messagesHistorique = fusionnerHistoriqueDm(
      etatHistoriqueDm.messagesAnciens,
      conversation.messages ?? []
    );
    // fusionnerHistoriqueDm() renvoie déjà un tableau trié par `envoi` : pas
    // besoin de re-trier l'ensemble à chaque rendu quand il n'y a aucun
    // message en attente (le cas de loin le plus fréquent) — voir le
    // commentaire équivalent dans renderer.js.
    const messages = messagesEnAttenteDeLaConversation.length
      ? [...messagesHistorique, ...messagesEnAttenteDeLaConversation].sort(
          (a, b) => a.envoi - b.envoi
        )
      : messagesHistorique;
    const otherUser = conversation.otherUser;

    if (topbarName) {
      topbarName.textContent = otherUser?.pseudo ?? t('dm.defaultUser');
    }
    if (topbarStatus) {
      topbarStatus.textContent = otherUser?.present
        ? t('dm.online')
        : t('dm.offline');
      topbarStatus.classList.toggle('online', Boolean(otherUser?.present));
      topbarStatus.classList.toggle('offline', !otherUser?.present);
    }
    if (topbarAvatar) {
      topbarAvatar.classList.toggle('offline', !otherUser?.present);
    }
    if (typingIndicator && isTypingNom) {
      // Dans un DM, une seule autre personne peut potentiellement écrire
      // (contrairement à un salon) — son nom est donc fixé une fois ici, à
      // l'ouverture de la conversation, plutôt que recalculé à chaque
      // battement de actualiserIndicateurSaisie() (qui ne gère, lui, que le
      // show/hide selon l'état de saisie réel — voir plus bas).
      isTypingNom.textContent = otherUser?.pseudo ?? t('dm.defaultUser');
    }

    // Mémorise la position de défilement AVANT de reconstruire la liste :
    // voir le commentaire équivalent dans afficherMessages() (renderer.js)
    // pour le pourquoi (sans ça, un chargement de messages plus anciens
    // ferait sauter la vue tout en haut).
    const hauteurAvant = messageList.scrollHeight;
    const scrollAvant = messageList.scrollTop;

    messageList.innerHTML = '';

    if (messages.length === 0) {
      // Conversation réellement vide : voir le commentaire équivalent dans
      // afficherMessages() (renderer.js) pour le pourquoi on n'affiche pas la
      // barre d'historique dans ce cas précis.
      const row = document.createElement('article');
      row.classList.add('message-row');

      const body = document.createElement('div');
      body.classList.add('message-body');

      const text = document.createElement('p');
      text.classList.add('text');
      text.textContent = t('dm.noMessagesYet');

      body.appendChild(text);
      row.appendChild(body);
      messageList.appendChild(row);
      return;
    }

    messageList.appendChild(
      creerStatutHistoriqueDm(etatHistoriqueDm, () =>
        chargerMessagesPlusAnciensDm()
      )
    );

    messages.forEach((message) => {
      const row = document.createElement('article');
      const isOwn = message.auteurId === state.currentUserId;
      const author = isOwn
        ? t('dm.me')
        : (otherUser?.pseudo ?? t('dm.defaultUser'));
      const timeLabel = new Date(message.envoi).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      row.classList.add('message-row');
      if (isOwn) {
        row.classList.add('own-message');
      }
      if (message.nonLivre) {
        row.classList.add('non-livre');
      }

      const avatar = document.createElement('div');
      avatar.classList.add('avatar');
      if (!otherUser?.present && !isOwn) {
        avatar.classList.add('offline');
      }

      const body = document.createElement('div');
      body.classList.add('message-body');

      const meta = document.createElement('div');
      meta.classList.add('message-meta');

      const authorEl = document.createElement('span');
      authorEl.classList.add('author');
      authorEl.textContent = author;

      const timeEl = document.createElement('span');
      timeEl.classList.add('timestamp');
      timeEl.textContent = timeLabel;

      const text = document.createElement('p');
      text.classList.add('text');
      remplirTexteMessage(text, message.contenu);

      meta.append(authorEl, timeEl);
      if (message.modification) {
        const edited = document.createElement('span');
        edited.classList.add('edited-label');
        edited.textContent = `(${t('messages.edited')})`;
        meta.appendChild(edited);
      }
      body.append(meta, text);
      if (message.nonLivre) {
        body.appendChild(creerActionsMessageNonLivre(message));
      } else if (isOwn) {
        body.appendChild(creerActionsMessage(message, text));
      }
      row.append(avatar, body);
      messageList.appendChild(row);
    });

    if (conserverPositionScroll) {
      // Charger plus ancien insère du contenu EN HAUT de la liste : voir le
      // commentaire équivalent dans afficherMessages() (renderer.js) pour le
      // pourquoi de ce recalcul.
      messageList.scrollTop =
        messageList.scrollHeight - hauteurAvant + scrollAvant;
    } else {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }

  /**
   * Charge la page de messages plus anciens qui précède ceux déjà affichés
   * pour la conversation active (pagination "charger plus ancien" — voir
   * obtenirMessagesPriveesAvant côté MockGatewayRuntime.js), et les fusionne
   * dans etatHistoriqueDm avant de redemander un rendu qui préserve la
   * position de défilement. Voir chargerMessagesPlusAnciensSalon dans
   * renderer.js pour l'équivalent salon (même garde-fous : pas d'effet si un
   * chargement est déjà en cours, si l'historique de la conversation active
   * est déjà entièrement remonté, ou si aucune conversation n'est active).
   */
  function creerActionsMessage(message, texteEl) {
    return ChatUiShared.creerActionsMessage({
      message,
      texteEl,
      api: window.electronAPI,
      utilisateurId: () => state.currentUserId,
      t,
      notifier,
      messageErreur,
      champMessage: messageInput,
      getEtatReseau: () => etatReseau,
    });
  }

  function creerActionsMessageNonLivre(message) {
    return ChatUiShared.creerActionsMessageNonLivre({
      message,
      t,
      enCours: messagesEnAttenteEnCoursDm.has(message.id),
      onReessayer: reessayerMessageEnAttenteDm,
      onSupprimer: supprimerMessageEnAttenteDm,
    });
  }

  async function chargerMessagesPlusAnciensDm() {
    const conversation = state.conversations.find(
      (entry) => entry.id === state.activeConversationId
    );
    if (
      !conversation ||
      etatHistoriqueDm.conversationId !== conversation.id ||
      etatHistoriqueDm.enChargement ||
      etatHistoriqueDm.finHistorique
    ) {
      return;
    }

    const plusAncienCharge =
      etatHistoriqueDm.messagesAnciens[0] ?? conversation.messages?.[0];

    etatHistoriqueDm.enChargement = true;
    await renderActiveConversation({ conserverPositionScroll: true });

    try {
      const resultat = await window.electronAPI.obtenirMessagesPriveesAvant({
        conversationId: conversation.id,
        utilisateurId: state.currentUserId,
        avantId: plusAncienCharge?.id,
      });
      if (etatHistoriqueDm.conversationId !== conversation.id) {
        return;
      }
      etatHistoriqueDm.messagesAnciens = fusionnerHistoriqueDm(
        etatHistoriqueDm.messagesAnciens,
        resultat.messages
      );
      etatHistoriqueDm.finHistorique = resultat.finHistorique;
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    } finally {
      if (etatHistoriqueDm.conversationId === conversation.id) {
        etatHistoriqueDm.enChargement = false;
        await renderActiveConversation({ conserverPositionScroll: true });
      }
    }
  }

  // Déclenchement automatique du chargement de l'historique plus ancien en
  // s'approchant du haut de la liste (défilement "progressif", en plus du
  // bouton explicite — voir creerStatutHistoriqueDm) : voir le commentaire
  // équivalent dans renderer.js pour le pourquoi de l'absence de garde
  // supplémentaire ici (chargerMessagesPlusAnciensDm est déjà protégée).
  if (messageList) {
    messageList.addEventListener('scroll', () => {
      if (messageList.scrollTop < 80) {
        chargerMessagesPlusAnciensDm();
      }
    });
  }

  function renderNewDmChoices() {
    if (!dmDialogContent) {
      return;
    }

    dmDialogContent.innerHTML = '';

    const candidats = state.utilisateurs.filter(
      (user) => user.id !== state.currentUserId
    );

    if (candidats.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('empty-state');
      empty.textContent = t('dm.noOtherUsers');
      dmDialogContent.appendChild(empty);
      return;
    }

    const liste = document.createElement('div');
    liste.classList.add('choice-list');

    candidats.forEach((user) => {
      const dejaOuverte = state.conversations.some(
        (conversation) => conversation.otherUser?.id === user.id
      );

      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.classList.add('user-choice');

      const nom = document.createElement('span');
      nom.textContent = user.pseudo;

      const action = document.createElement('span');
      action.textContent = dejaOuverte
        ? t('dm.openExisting')
        : t('dm.newLabel');

      bouton.append(nom, action);

      bouton.addEventListener('click', async () => {
        try {
          const conversation =
            await window.electronAPI.demarrerConversationPrivee({
              utilisateurId: state.currentUserId,
              autreUtilisateurId: user.id,
            });
          dmDialog?.close();
          state.activeConversationId = conversation.id;
          state.currentFilter = 'all';
          filterButtons.forEach((item) => {
            item.classList.toggle('active', item.dataset.filter === 'all');
          });
          await refreshConversations();
        } catch (erreur) {
          notifier(messageErreur(erreur), true);
        }
      });

      liste.appendChild(bouton);
    });

    dmDialogContent.appendChild(liste);
  }

  if (openNewDmBtn && dmDialog) {
    openNewDmBtn.addEventListener('click', () => {
      renderNewDmChoices();
      dmDialog.showModal();
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      state.currentFilter = button.dataset.filter ?? 'all';
      filterButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
      });

      const visible = getFilteredConversations();
      if (visible.length === 0) {
        state.activeConversationId = null;
      } else if (
        !visible.some(
          (conversation) => conversation.id === state.activeConversationId
        )
      ) {
        state.activeConversationId = visible[0].id;
      }

      // Voir le commentaire dans refreshConversations() : marquer comme lu
      // doit se faire avant de recalculer les ronds de notification.
      await renderActiveConversation();
      renderConversationList();
      mettreAJourBadgeApplication();
    });
  });

  const timersArretSaisieDm = {};

  if (messageForm && messageInput) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const content = messageInput.value.trim();
      if (!content || !state.activeConversationId) {
        return;
      }

      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;
      messageInput.value = '';

      // Hors ligne (etatReseau, JAMAIS `presences` — voir le commentaire sur
      // messagesEnAttenteDm) : le message est affiché tout de suite, marqué
      // "non livré", sans jamais être transmis au gateway. Se mettre
      // soi-même "hors-ligne" via le bouton de présence
      // (brancherControlesReseauPresence) n'a donc aucun effet ici, seule
      // une vraie coupure réseau simulée (#simulate-network-cut, qui change
      // etatReseau) en a.
      if (etatReseau.statut !== 'connecte') {
        ajouterMessageEnAttenteDm(
          conversationId,
          ChatUiShared.creerMessageEnAttente({
            conversationId,
            auteurId,
            contenu: content,
          })
        );
        // conserverPositionScroll: true — voir reessayerMessageEnAttenteDm
        // plus haut : sans lui, afficher ce brouillon "non livré" fait
        // sauter la vue en bas de la conversation même si l'utilisateur
        // lisait plus haut dans l'historique.
        await renderActiveConversation({ conserverPositionScroll: true });
        return;
      }

      // 1. Annule le timer d'inactivité de cet utilisateur s'il existe
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      // 2. Réinitialise immédiatement l'état de saisie
      await window.electronAPI.modifierEtatSaisie({
        conversationId,
        utilisateurId: auteurId,
        est_saisie: false,
      });

      // 3. Envoie le message. L'envoi et le rafraîchissement qui suit ont
      // chacun leur propre try/catch (voir reessayerMessageEnAttenteDm plus
      // haut pour le détail du pourquoi) : sans cette séparation, un
      // refreshConversations() en échec APRÈS un envoi pourtant réussi
      // tomberait dans le même bloc catch qu'un envoi raté — le message
      // (déjà bien parti côté serveur) serait alors à tort remis en
      // attente en double, avec une notification d'échec trompeuse.
      try {
        await window.electronAPI.envoyerMessagePrive({
          conversationId,
          contenu: content,
          utilisateurId: auteurId,
        });
      } catch (erreur) {
        // Connecté au moment de l'envoi mais échec en cours de route : même
        // traitement qu'un envoi tenté hors ligne, plutôt que de perdre le
        // texte tapé (voir le commentaire plus haut).
        ajouterMessageEnAttenteDm(
          conversationId,
          ChatUiShared.creerMessageEnAttente({
            conversationId,
            auteurId,
            contenu: content,
          })
        );
        // conserverPositionScroll: true — voir reessayerMessageEnAttenteDm
        // plus haut pour le pourquoi.
        await renderActiveConversation({ conserverPositionScroll: true });
        notifier(messageErreur(erreur), true);
        return;
      }
      try {
        await refreshConversations();
      } catch (erreur) {
        // Le message est bien parti ; seul le rechargement de la liste des
        // conversations a échoué ensuite — à ne pas confondre avec un échec
        // d'envoi (pas de brouillon "non livré" ajouté pour un message déjà
        // livré).
        notifier(messageErreur(erreur), true);
        await renderActiveConversation({ conserverPositionScroll: true });
      }
    });

    messageInput.addEventListener('input', async (event) => {
      if (etatReseau.statut !== 'connecte') return;
      const aDuTexte = event.target.value.trim().length > 0;
      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;

      if (!auteurId || !conversationId) return;

      // Annule le timer précédent de cet utilisateur
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      if (aDuTexte) {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: true,
        });

        // Coupe l'état de saisie après 10 secondes sans frappe
        timersArretSaisieDm[auteurId] = setTimeout(async () => {
          delete timersArretSaisieDm[auteurId];
          if (etatReseau.statut !== 'connecte') return;
          await window.electronAPI.modifierEtatSaisie({
            conversationId,
            utilisateurId: auteurId,
            est_saisie: false,
          });
          await actualiserIndicateurSaisie();
        }, 10000);
      } else {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: false,
        });
        await actualiserIndicateurSaisie();
      }
    });
  }

  // Salons actuels de `state.currentUserId`, telle que renvoyée par
  // obtenirEtatSalons() (voir preload.js). Petit helper pour permettre à un
  // appelant qui a besoin à la fois de actualiserBadgeSalons() ET de
  // mettreAJourBadgeApplication() de ne faire qu'un seul appel IPC pour les
  // deux (voir leur paramètre optionnel `salonsPreChauffes` plus bas).
  async function obtenirSalonsActuels() {
    const etatSalons = await window.electronAPI.obtenirEtatSalons(
      state.currentUserId
    );
    return etatSalons?.salons ?? [];
  }

  // --- Badge "non lu" sur le rail (icônes qui ramènent à l'accueil) -------
  // Ces icônes vivent sur CETTE page mais doivent refléter l'état des
  // salons (autre page/fichier). Best-effort et silencieux : un badge qui
  // ne se met pas à jour n'est pas une raison de perturber le reste de
  // l'app.
  async function actualiserBadgeSalons(salonsPreChauffes) {
    const dots = document.querySelectorAll('#server-rail .notif-dot');
    if (!dots.length) return;
    if (!NotifPrefs.afficheRonds(state.currentUserId)) {
      dots.forEach((dot) => (dot.hidden = true));
      return;
    }
    try {
      const salons = salonsPreChauffes ?? (await obtenirSalonsActuels());
      const nonLu = salons.some((salon) =>
        NotifPrefs.estNonLu(
          state.currentUserId,
          salon.id,
          NotifPrefs.dernierMessageSalon(salon)
        )
      );
      dots.forEach((dot) => (dot.hidden = !nonLu));
    } catch {
      // Badge best-effort, voir commentaire ci-dessus.
    }
  }

  /**
   * Recalcule le nombre total de conversations non lues (salons + messages
   * privés) pour l'utilisateur courant et met à jour le badge de l'icône de
   * l'app (voir mettreAJourBadgeApplication côté main.js). Respecte
   * NotifPrefs.afficheRonds() comme les ronds de notification. Best-effort
   * et silencieux.
   *
   * Le calcul du compte et le dessin de l'icône de badge vivent dans
   * NotifPrefs (notif-prefs.js), partagés avec renderer.js — voir son
   * en-tête pour le pourquoi (évite la divergence entre deux copies).
   *
   * @param {Array} [salonsPreChauffes] Liste de salons déjà récupérée par
   *   l'appelant (voir actualiserBadgeSalons ci-dessus) : évite un second
   *   appel IPC obtenirEtatSalons() identique quand les deux fonctions sont
   *   appelées l'une après l'autre.
   */
  async function mettreAJourBadgeApplication(salonsPreChauffes) {
    if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
    if (!NotifPrefs.afficheRonds(state.currentUserId)) {
      NotifPrefs.appliquerBadge(serviceNotifications, 0);
      return;
    }
    let salons = salonsPreChauffes;
    if (!salons) {
      try {
        salons = await obtenirSalonsActuels();
      } catch {
        salons = [];
      }
    }
    let nombre = NotifPrefs.compterSalonsNonLus(state.currentUserId, salons);
    nombre += NotifPrefs.compterConversationsNonLues(
      state.currentUserId,
      state.conversations
    );
    NotifPrefs.appliquerBadge(serviceNotifications, nombre);
  }

  // --- Menu de préférences de notification --------------------------------
  function fermerMenuNotif() {
    if (!notifMenu || notifMenu.hidden) return;
    notifMenu.hidden = true;
    notifBtn?.setAttribute('aria-expanded', 'false');
  }

  function ouvrirMenuNotif() {
    if (!notifMenu) return;
    const modeActuel = NotifPrefs.obtenirMode(state.currentUserId);
    notifMenu.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
      radio.checked = radio.value === modeActuel;
    });
    notifMenu.hidden = false;
    notifBtn?.setAttribute('aria-expanded', 'true');
  }

  notifBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (notifMenu?.hidden === false) {
      fermerMenuNotif();
    } else {
      ouvrirMenuNotif();
    }
  });

  notifMenu?.addEventListener('click', (event) => event.stopPropagation());

  notifMenu?.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      NotifPrefs.definirMode(state.currentUserId, radio.value);
      fermerMenuNotif();
      renderConversationList();
      // Un seul appel obtenirEtatSalons(), partagé entre les deux mises à
      // jour ci-dessous, plutôt qu'un appel indépendant dans chacune.
      const salons = await obtenirSalonsActuels().catch(() => []);
      actualiserBadgeSalons(salons);
      mettreAJourBadgeApplication(salons);
      notifier(t('notifications.preferenceUpdated'));
    });
  });

  document.addEventListener('click', fermerMenuNotif);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fermerMenuNotif();
  });

  // --- Messages de démo simulés (une fois) par main.js ----------------------
  // Voir demarrerSimulationMessages() dans main.js et le même bloc dans
  // renderer.js : un message privé (ariane → sam) après 5s et un message
  // dans #général après 10s, une seule fois, quelle que soit la page
  // actuellement affichée. C'est ce fichier (pas main.js) qui décide, selon
  // le mode NotifPrefs de l'utilisateur actuellement affiché ici, s'il faut
  // déclencher une notification système. Le corps commun (log de
  // diagnostic, résolution du mode, décision de notifier) vit dans
  // NotifPrefs.traiterMessageSimule (notif-prefs.js), partagé avec
  // renderer.js.
  if (typeof serviceNotifications?.onMockMessage === 'function') {
    serviceNotifications.onMockMessage((message) =>
      NotifPrefs.traiterMessageSimule(message, {
        utilisateurId: state.currentUserId,
        surSalon: async () => {
          // Un seul appel obtenirEtatSalons(), partagé entre les deux mises
          // à jour ci-dessous (voir le paramètre salonsPreChauffes de
          // mettreAJourBadgeApplication).
          const salons = await obtenirSalonsActuels().catch(() => []);
          await actualiserBadgeSalons(salons);
          mettreAJourBadgeApplication(salons);
        },
        surPrive: () => refreshConversations(),
        notifierMessageSysteme,
      })
    );
  }

  ChatUiShared.brancherControlesReseauPresence({
    api: window.electronAPI,
    elements: {
      couperReseau: simulateNetworkCut,
      reconnecterReseau: simulateNetworkReconnect,
      presenceCourante: currentUserPresence,
    },
    getEtatReseau: () => etatReseau,
    getUtilisateurId: () => state.currentUserId,
    getPresences: () => presences,
    notifierErreur: (erreur) => notifier(messageErreur(erreur), true),
  });

  window.electronAPI.onEtatReseauChange((nouvelEtat) => {
    afficherEtatReseau(nouvelEtat);
  });

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

  window.electronAPI.onMessageModifieChange(async () => {
    await refreshConversations({ conserverPositionScroll: true });
  });

  window.electronAPI.onMessageSupprimeChange(async (message) => {
    ChatUiShared.oublierEtatActionMessage(message?.messageId);
    await refreshConversations({ conserverPositionScroll: true });
  });

  await initialiserUtilisateurCourant();
  await chargerEtatReseauEtPresences();
  await refreshConversations();
  await actualiserBadgeSalons();
});

// Toute icône de la barre latérale (logo + icônes de serveur) ramène au
// serveur : il n'y a qu'un seul espace de travail dans cette app, donc
// n'importe quelle icône de #server-rail sert d'affordance de retour,
// qu'on soit ou non sur la page des messages privés.
const railButtons = document.querySelectorAll('#server-rail button');

railButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    window.electronAPI.navigate('index.html');
  });
});
