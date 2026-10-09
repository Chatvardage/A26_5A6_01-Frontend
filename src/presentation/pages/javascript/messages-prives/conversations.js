// messages-prives/conversations.js — Liste des conversations, indicateur de saisie,
// intégration des messages reçus, préférences.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

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

/**
 * Recharge TOUTES les conversations (une requête d'historique par
 * interlocuteur, voir obtenirConversationsPrivees) puis les affiche.
 * Réservé au chargement de la page et aux cas qu'un ajout local ne couvre
 * pas (nouvel interlocuteur…) : un message reçu, envoyé, modifié ou
 * supprimé passe par integrerMessagePrive / appliquerMessage* (plus bas).
 */
async function refreshConversations(options = {}) {
  try {
    state.conversations = await window.electronAPI.obtenirConversationsPrivees(
      state.currentUserId
    );
  } catch (erreur) {
    // Liste précédente gardée (vide au premier chargement), erreur signalée
    // et nouvel essai automatique : avant, un échec passager affichait une
    // liste vide sans rien dire.
    notifier(messageErreur(erreur), true);
    planifierNouvelEssaiConversations();
    return;
  }
  // Pseudo d'un interlocuteur pas encore résolu : redemandé plus tard, sans
  // message (le nom brut est affiché en attendant).
  if (state.conversations.some((c) => c.otherUser?.pseudoInconnu)) {
    planifierNouvelEssaiConversations();
  }
  await afficherConversations(options);
}

// Nouvel essai de refreshConversations après un échec (un seul en attente).
const DELAI_NOUVEL_ESSAI_CONVERSATIONS_MS = 5000;
let minuteurNouvelEssaiConversations = null;

function planifierNouvelEssaiConversations() {
  if (minuteurNouvelEssaiConversations) return;
  minuteurNouvelEssaiConversations = window.setTimeout(() => {
    minuteurNouvelEssaiConversations = null;
    void refreshConversations({ conserverPositionScroll: true });
  }, DELAI_NOUVEL_ESSAI_CONVERSATIONS_MS);
}

/** Trie les conversations (activité la plus récente en premier) et les
 * réaffiche, SANS appel réseau. */
async function afficherConversations(options = {}) {
  state.conversations = LogiqueInterface.trierConversations(
    state.conversations
  );

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
  // (NotifPrefs.marquerLu). Si renderConversationList() tournait en
  // premier, le rond de notification de cette conversation serait calculé
  // avec l'ancien état (non lu) et ne disparaîtrait qu'au prochain
  // rafraîchissement.
  await renderActiveConversation(options);
  renderConversationList();
  mettreAJourBadgeApplication();
  actualiserIndicateurSaisie();
}

function trouverConversation(conversationId) {
  return state.conversations.find(
    (conversation) => conversation.id === conversationId
  );
}

/**
 * Message privé reçu (temps réel) ou envoyé (réponse du serveur) : ajouté
 * à sa conversation déjà chargée, sans recharger les autres (auparavant,
 * chaque message reçu refaisait une requête d'historique par
 * interlocuteur). Premier message d'un interlocuteur encore absent de la
 * liste : rechargement complet, une seule fois.
 */
async function integrerMessagePrive(message, options = {}) {
  const conversation = trouverConversation(message?.conversationId);
  if (!conversation) {
    await refreshConversations(options);
    return;
  }
  if (
    message.auteurId === state.currentUserId &&
    etatHistoriqueDm.ancreId &&
    etatHistoriqueDm.conversationId === conversation.id
  ) {
    etatHistoriqueDm = {
      conversationId: conversation.id,
      messagesAnciens: [],
      finHistorique: Boolean(conversation.finHistorique),
      enChargement: false,
    };
    options = {};
  }
  conversation.messages = LogiqueInterface.ajouterMessage(
    conversation.messages,
    message,
    'envoi'
  );
  conversation.lastMessage =
    conversation.messages[conversation.messages.length - 1];
  await afficherConversations(options);
}

const remplacerMessage = LogiqueInterface.remplacerMessage;

/** Message privé modifié : mis à jour sur place. Les messages de salon
 * (sans conversationId) ne concernent pas cette page. */
async function appliquerMessageModifie(message) {
  const conversation = trouverConversation(message?.conversationId);
  if (!conversation) return;
  conversation.messages = remplacerMessage(conversation.messages, message);
  if (conversation.lastMessage?.id === message.id) {
    conversation.lastMessage = { ...conversation.lastMessage, ...message };
  }
  if (etatHistoriqueDm.conversationId === conversation.id) {
    etatHistoriqueDm.messagesAnciens = remplacerMessage(
      etatHistoriqueDm.messagesAnciens,
      message
    );
  }
  await afficherConversations({ garderScroll: true });
}

/** Message privé supprimé : retiré sur place (introuvable ici = message de
 * salon, ignoré). */
async function appliquerMessageSupprime(messageId) {
  const conversation = state.conversations.find(
    (item) =>
      item.lastMessage?.id === messageId ||
      LogiqueInterface.contientMessage(item.messages, messageId) ||
      (etatHistoriqueDm.conversationId === item.id &&
        LogiqueInterface.contientMessage(
          etatHistoriqueDm.messagesAnciens,
          messageId
        ))
  );
  if (!conversation) return;
  conversation.messages = LogiqueInterface.retirerMessage(
    conversation.messages,
    messageId
  );
  if (etatHistoriqueDm.conversationId === conversation.id) {
    etatHistoriqueDm.messagesAnciens = LogiqueInterface.retirerMessage(
      etatHistoriqueDm.messagesAnciens,
      messageId
    );
  }
  if (conversation.lastMessage?.id === messageId) {
    if (conversation.messages.length === 0) {
      // Plus aucun message récent en mémoire : le nouveau « dernier
      // message » est peut-être plus ancien que la page chargée.
      await refreshConversations({ garderScroll: true });
      return;
    }
    conversation.lastMessage =
      conversation.messages[conversation.messages.length - 1];
  }
  await afficherConversations({ garderScroll: true });
}

/**
 * Résout l'utilisateur réellement connecté (session JWT) — voir
 * initialiserUtilisateurCourant dans renderer.js pour l'équivalent salon et
 * le même raisonnement (une seule identité possible par session désormais,
 * plus de sélecteur de test). `state.utilisateurs` reste peuplé via
 * obtenirUtilisateurs() : ce n'est pas un répertoire global,
 * mais un cache d'utilisateurs "connus" (voir son
 * commentaire dans RealGatewayRuntime.js) — encore utile ici pour la liste
 * de candidats "Nouveau message privé" (voir renderNewDmChoices).
 */
async function initialiserUtilisateurCourant() {
  state.utilisateurs = await window.electronAPI.obtenirUtilisateurs();
  state.utilisateurActuel =
    await window.electronAPI.obtenirUtilisateurConnecte();
  state.currentUserId = state.utilisateurActuel?.id ?? '';
  appliquerPreferences(await window.electronAPI.obtenirPreferences());
  afficherUtilisateurCourant();
}

/** Voir appliquerPreferences dans renderer.js. */
function appliquerPreferences(nouvelles) {
  if (!nouvelles) return;
  state.preferences = nouvelles;
  ThemeManager.appliquerTheme(nouvelles.theme);
  if (nouvelles.langue) I18n.definirLangueActuelle(nouvelles.langue);
  NotifPrefs.definirMode(state.currentUserId, nouvelles.modeNotification);
}

// Changement dans un de mes serveurs (temps réel) : le rail de cette page
// est mis à jour ; messages pour une expulsion ou une invitation.
let minuteurRail = null;

/** Nouveaux messages reçus en temps réel (salon ou DM). Appelée une fois, au démarrage (message-prive.js). */
function brancherMessagesRecus() {
  if (typeof window.electronAPI?.onNouveauMessage === 'function') {
    window.electronAPI.onNouveauMessage((payload) => {
      if (!payload?.message) return;
      const estSalon = payload.conversationType === 'salon';
      const messageNormalise = {
        type: estSalon ? 'salon' : 'prive',
        auteurId: payload.message.auteurId,
        contenu: payload.message.contenu,
        conversationId: estSalon
          ? payload.salonId
          : payload.message.conversationId,
      };
      // Message d'autrui : un non-lu de plus. S'il arrive dans la
      // conversation affichée, fenêtre au premier plan, son affichage le
      // marque aussitôt lu (voir renderActiveConversation) ; sinon il reste
      // compté (conversation, serveur du rail, badge).
      if (payload.message.auteurId !== state.currentUserId) {
        NotifPrefs.ajouterNonLu(
          messageNormalise.type,
          messageNormalise.conversationId
        );
      }
      NotifPrefs.traiterMessageRecu(messageNormalise, {
        utilisateurId: state.currentUserId,
        api: window.electronAPI,
        surNonLusActualises: async () => {
          renderConversationList();
          await actualiserBadgeSalons({ recharger: false });
          mettreAJourBadgeApplication();
        },
        surSalon: async () => {
          // Aucun appel réseau : les compteurs suffisent aux pastilles.
          await actualiserBadgeSalons({ recharger: false });
          mettreAJourBadgeApplication();
        },
        // Si c'est la conversation actuellement affichée, refreshConversations()
        // la réaffiche avec le nouveau message ; sinon seuls la liste et le
        // badge sont mis à jour (voir son corps). La vue ne descend sur le
        // nouveau message que s'il est dans la conversation affichée et
        // qu'on est l'auteur ou déjà en bas (voir renderer.js,
        // integrerMessageSalonRecu, même règle).
        surPrive: () => {
          const suivre = LogiqueInterface.doitSuivreNouveauMessage({
            dansConversationAffichee:
              payload.message.conversationId === state.activeConversationId,
            estAuteur: payload.message.auteurId === state.currentUserId,
            presDuBas: LogiqueInterface.estPresDuBas(messageList),
          });
          return integrerMessagePrive(
            payload.message,
            suivre ? {} : { garderScroll: true }
          );
        },
        notifierMessageSysteme,
      });
    });
  }
}
