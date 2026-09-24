// salons/historique.js — Historique paginé des salons et messages non livrés (hors ligne).
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).

// --- Historique et pagination des messages (salons) -----------------------
// `salons:etat` (voir actualiser()) ne renvoie déjà plus que la page de
// messages la plus récente d'un salon (voir obtenirEtat côté
// RealGatewayRuntime.js) : cet état garde en mémoire, PAR-DESSUS cette page
// récente, les pages plus anciennes chargées à la demande (voir
// chargerMessagesPlusAnciensSalon) pour le salon actuellement affiché.
// Volontairement réinitialisé au changement de salon actif (voir
// afficherMessages()) : contrairement aux messages reçus/envoyés, l'historique
// remonté manuellement n'a pas de raison de survivre à un changement de
// conversation.
let etatHistoriqueSalon = {
  salonId: null,
  messagesAnciens: [],
  finHistorique: false,
  enChargement: false,
};

// --- Messages non livrés (hors ligne) --------------------------------------
// Messages tapés pendant que etatReseau.statut !== 'connecte' (ou dont
// l'envoi a échoué en cours de route) : jamais transmis au gateway, gardés
// uniquement ici par salon en attendant que l'utilisateur clique "réessayer"
// ou "supprimer" (voir creerActionsMessageNonLivre dans chat-ui-shared.js).
// Volontairement PAS persisté (StockageLocal) : contrairement à l'historique
// des salons, un brouillon jamais envoyé n'a pas vocation à survivre à un
// redémarrage de l'app. Ceci dit, la Map elle-même n'est jamais purgée pour
// un salon que l'utilisateur quitte ou ne revisite plus : c'est accepté tel
// quel (portée d'une session en mémoire, jamais persisté), pas un oubli.
const messagesEnAttenteSalon = new Map();

// Ids des messages actuellement en cours de renvoi (voir
// reessayerMessageEnAttenteSalon ci-dessous) : sans cette garde, deux clics
// rapprochés sur "Réessayer" pour le même message pourraient déclencher deux
// appels envoyerMessageSalon() pour le même contenu, créant deux messages
// bien réels côté serveur pour une seule action utilisateur. Elle sert aussi
// à empêcher "Supprimer" d'agir tant qu'un envoi est déjà parti pour ce
// message (voir supprimerMessageEnAttenteSalon) : sans ça, l'utilisateur
// pourrait croire avoir annulé un message alors que la requête réseau déjà
// en vol va quand même aboutir.
const messagesEnAttenteEnCoursSalon = new Set();

function ajouterMessageEnAttenteSalon(salonId, message) {
  const liste = messagesEnAttenteSalon.get(salonId) ?? [];
  liste.push(message);
  messagesEnAttenteSalon.set(salonId, liste);
}

// Ne renvoie que les messages en attente de l'utilisateur COURANT
// (utilisateurActuelId) : la Map est indexée par salon, pas par utilisateur —
// filtre conservé par prudence même s'il n'y a qu'une seule identité
// par session, au cas où plusieurs salons partageraient un jour la
// même Map d'une façon qui réintroduirait cette ambiguïté.
function obtenirMessagesEnAttenteSalon(salonId) {
  const liste = messagesEnAttenteSalon.get(salonId) ?? [];
  return liste.filter((message) => message.auteurId === utilisateurActuelId);
}

function retirerMessageEnAttenteSalon(salonId, messageId) {
  const liste = messagesEnAttenteSalon.get(salonId);
  if (!liste) return;
  const restants = liste.filter((message) => message.id !== messageId);
  if (restants.length) {
    messagesEnAttenteSalon.set(salonId, restants);
  } else {
    messagesEnAttenteSalon.delete(salonId);
  }
}

/**
 * Retente l'envoi d'un message resté "non livré". Vérifie explicitement
 * etatReseau (EtatConnexion) — jamais `presences` : simuler sa propre
 * présence "hors-ligne" (page profil) ne doit pas
 * empêcher de réessayer, seule une vraie coupure réseau le doit.
 */
async function reessayerMessageEnAttenteSalon(message) {
  // Garde anti-double-envoi (voir messagesEnAttenteEnCoursSalon) : un second
  // clic (ou un second appel) pendant qu'une tentative est déjà en cours
  // pour CE message ne doit rien déclencher de plus.
  if (messagesEnAttenteEnCoursSalon.has(message.id)) return;
  if (etatReseau.statut !== 'connecte') {
    notifier(t('messages.stillOffline'), true);
    return;
  }
  messagesEnAttenteEnCoursSalon.add(message.id);
  // Réaffiche tout de suite (avant l'await) pour désactiver visuellement les
  // boutons réessayer/supprimer de ce message pendant que la requête est en
  // vol — voir messagesEnAttenteEnCoursSalon.
  afficherMessages({ conserverPositionScroll: true });

  // L'envoi et le rafraîchissement (actualiser()) ont chacun leur propre
  // try/catch, volontairement séparés — voir reessayerMessageEnAttenteDm
  // dans message-prive.js pour l'équivalent DM et le détail du pourquoi :
  // les regrouper ferait qu'un actualiser() en échec APRÈS un envoi réussi
  // tomberait dans le même bloc catch qu'un envoi raté, et serait alors
  // traité comme tel (notification "échec"), alors que le message est déjà
  // bien parti côté serveur à ce moment-là. (actualiser() attrape déjà ses
  // propres erreurs en interne et ne les relance jamais, donc ce cas ne se
  // produit pas aujourd'hui — cette séparation documente explicitement
  // cette garantie plutôt que d'en dépendre implicitement, et garde les
  // deux fichiers symétriques.)
  try {
    await window.electronAPI.envoyerMessageSalon({
      salonId: message.conversationId,
      utilisateurId: message.auteurId,
      contenu: message.contenu,
    });
  } catch (erreur) {
    // Ici seulement, l'envoi lui-même a échoué : le message reste "non
    // livré" (rien à retirer de messagesEnAttenteSalon).
    messagesEnAttenteEnCoursSalon.delete(message.id);
    notifier(messageErreur(erreur), true);
    afficherMessages({ conserverPositionScroll: true });
    return;
  }

  // Envoi réussi : retiré de la liste d'attente quoi qu'il arrive au
  // rafraîchissement ci-dessous. Pas de afficherMessages() intermédiaire ici
  // (contrairement à une version précédente) : le message vient d'être
  // retiré de messagesEnAttenteSalon mais n'est pas encore dans les données
  // fraîches du serveur, donc un rendu à ce stade précis le ferait
  // disparaître brièvement de l'écran avant que actualiser() (via
  // afficherTout -> afficherMessages, voir plus bas) ne le réaffiche à
  // partir des données serveur. Symétrique avec reessayerMessageEnAttenteDm
  // dans message-prive.js, qui n'a jamais eu ce rendu intermédiaire.
  retirerMessageEnAttenteSalon(message.conversationId, message.id);
  messagesEnAttenteEnCoursSalon.delete(message.id);
  try {
    await actualiser();
  } catch (erreur) {
    // Garde défensive pure : actualiser() attrape déjà ses propres erreurs
    // en interne et ne les relance jamais (voir sa définition), donc ce
    // bloc ne devrait jamais s'exécuter aujourd'hui. Il existe pour ne pas
    // dépendre implicitement de ce contrat non appliqué par le compilateur —
    // si un futur refactor d'actualiser() laissait une erreur se propager,
    // on veut une notification "échec" propre (comme côté DM, où
    // refreshConversations() propage réellement les siennes — voir
    // reessayerMessageEnAttenteDm dans message-prive.js) plutôt qu'un rejet
    // de promesse non géré.
    notifier(messageErreur(erreur), true);
  }
}

function supprimerMessageEnAttenteSalon(message) {
  // Refuse de supprimer un message dont l'envoi est actuellement en cours
  // (voir messagesEnAttenteEnCoursSalon et reessayerMessageEnAttenteSalon) :
  // la requête déjà partie aboutira de toute façon, donc "supprimer" ici ne
  // ferait qu'induire l'utilisateur en erreur sur ce qui a réellement été
  // envoyé.
  if (messagesEnAttenteEnCoursSalon.has(message.id)) return;
  retirerMessageEnAttenteSalon(message.conversationId, message.id);
  afficherMessages({ conserverPositionScroll: true });
}

function creerActionsMessageNonLivre(message) {
  return ChatUiShared.creerActionsMessageNonLivre({
    message,
    t,
    enCours: messagesEnAttenteEnCoursSalon.has(message.id),
    onReessayer: reessayerMessageEnAttenteSalon,
    onSupprimer: supprimerMessageEnAttenteSalon,
  });
}

// Fusions d'historique et de brouillons : logique pure partagée avec la page
// des messages privés et testée à 100 % (voir logique-interface.js).
const LogiqueInterface = window.LogiqueInterface;
if (!LogiqueInterface) {
  throw new Error('logique-interface.js doit être chargé avant salons/*.js');
}
const fusionnerHistorique = LogiqueInterface.fusionnerHistorique;
const fusionnerAvecMessagesEnAttente =
  LogiqueInterface.fusionnerAvecMessagesEnAttente;

/**
 * Construit l'élément affiché en haut de la liste des messages pour
 * représenter l'état de l'historique : en cours de chargement, épuisé (début
 * de la conversation), ou disponible (bouton "charger plus ancien" — voir
 * aussi le déclenchement automatique au défilement dans el.messages
 * ('scroll') plus bas).
 *
 * @param {{enChargement: boolean, finHistorique: boolean}} etatHistorique
 * @param {() => void} surClicChargerPlus
 */
function creerStatutHistorique(etatHistorique, surClicChargerPlus) {
  if (etatHistorique.enChargement) {
    return creerEl('div', {
      classe: 'historique-statut historique-statut--chargement',
      texte: t('history.loading'),
      attrs: { 'aria-live': 'polite' },
    });
  }
  if (etatHistorique.finHistorique) {
    return creerEl('div', {
      classe: 'historique-statut historique-statut--fin',
      texte: t('history.endOfHistory'),
    });
  }
  const bouton = creerEl('button', {
    classe: 'historique-statut historique-statut--bouton',
    texte: t('history.loadOlder'),
    attrs: { type: 'button' },
  });
  bouton.addEventListener('click', surClicChargerPlus);
  return bouton;
}

// Aucun HTML n'est jamais construit sous forme de chaîne dans ce fichier :
// tout est créé via document.createElement / textContent, donc il n'y a
// structurellement rien à échapper — pas d'innerHTML, pas de risque de XSS
// stocké si un futur champ est ajouté à un des gabarits ci-dessous.

