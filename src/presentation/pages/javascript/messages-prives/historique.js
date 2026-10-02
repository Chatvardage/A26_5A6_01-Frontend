// messages-prives/historique.js — Messages non livrés et pagination de l'historique.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

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
// (voir obtenirConversationsPrivees côté RealGatewayRuntime.js) : cet
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
// le pourquoi) : sans ce filtre, se reconnecter avec un autre compte ferait
// apparaître les brouillons non livrés du compte précédent dans cette
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
 * présence "hors-ligne" (page profil) ne doit pas
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
  let envoye;
  try {
    envoye = await window.electronAPI.envoyerMessagePrive({
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
    // Message renvoyé par le serveur : pas de rechargement complet.
    await integrerMessagePrive(envoye);
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

// Fusions d'historique et de brouillons (champ date 'envoi') : logique
// pure partagée avec la page des salons et testée à 100 % (voir
// logique-interface.js).
const fusionnerHistoriqueDm = (messagesAnciens, messagesRecents) =>
  LogiqueInterface.fusionnerHistorique(
    messagesAnciens,
    messagesRecents,
    'envoi'
  );
const fusionnerAvecMessagesEnAttenteDm = (messagesTries, messagesEnAttente) =>
  LogiqueInterface.fusionnerAvecMessagesEnAttente(
    messagesTries,
    messagesEnAttente,
    'envoi'
  );

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
