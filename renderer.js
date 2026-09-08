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
      traiterMessageSimule: async () => {},
    };
  })();
let utilisateurActuelId = sessionStorage.getItem('currentUserId') ?? null;
let salonActifId = null;
let etat = { utilisateurs: [], salons: [], invitations: [] };
let presences = {};
let etatReseau = { statut: 'connecte', reconnexions: 0 };
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
  invitations: document.querySelector('#open-invitations'),
  compteur: document.querySelector('#invitation-count'),
  utilisateur: document.querySelector('#current-user-select'),
  langue: document.querySelector('#language-select'),
  dialogue: document.querySelector('#app-dialog'),
  titreDialogue: document.querySelector('#dialog-title'),
  contenuDialogue: document.querySelector('#dialog-content'),
  toast: document.querySelector('#toast'),
  statutConnexion: document.querySelector('#connection-status'),
  libelleConnexion: document.querySelector('#connection-label'),
  couperReseau: document.querySelector('#simulate-network-cut'),
  reconnecterReseau: document.querySelector('#simulate-network-reconnect'),
  presenceCourante: document.querySelector('#current-user-presence'),
};


function afficherEtatReseau(nouvelEtat = etatReseau) {
  etatReseau = nouvelEtat ?? etatReseau;
  if (!el.statutConnexion || !el.libelleConnexion) return;
  el.statutConnexion.dataset.state = etatReseau.statut;
  const libelles = {
    connecte: t('network.connected'),
    deconnecte: t('network.disconnected'),
    reconnexion: t('network.reconnecting'),
  };
  el.libelleConnexion.textContent = libelles[etatReseau.statut] ?? etatReseau.statut;
  const bloque = etatReseau.statut !== 'connecte';
  if (el.message) el.message.disabled = bloque;
  if (el.presenceCourante) el.presenceCourante.disabled = bloque;
  if (el.couperReseau) el.couperReseau.disabled = bloque;
  if (el.reconnecterReseau) el.reconnecterReseau.disabled = etatReseau.statut === 'connecte';
}

function afficherPresenceCourante() {
  if (!el.presenceCourante || !utilisateurActuelId) return;
  const statut = presences[utilisateurActuelId] ?? 'hors-ligne';
  el.presenceCourante.dataset.presence = statut;
  el.presenceCourante.textContent = statut === 'en-ligne'
    ? t('network.online')
    : t('network.offline');
}

async function chargerEtatReseauEtPresences() {
  const [reseau, presencesRecues] = await Promise.all([
    window.electronAPI.obtenirEtatReseau(),
    window.electronAPI.obtenirPresences(),
  ]);
  etatReseau = reseau;
  presences = presencesRecues;
  afficherEtatReseau();
  afficherPresenceCourante();
}

const salonActif = () => etat.salons.find((salon) => salon.id === salonActifId);
const utilisateur = (id) => etat.utilisateurs.find((item) => item.id === id);

// --- Historique et pagination des messages (salons) -----------------------
// `salons:etat` (voir actualiser()) ne renvoie déjà plus que la page de
// messages la plus récente d'un salon (voir construireSalonDTO côté
// MockGatewayRuntime.js) : cet état garde en mémoire, PAR-DESSUS cette page
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

/**
 * Fusionne les messages déjà remontés manuellement (plus anciens) avec la
 * page récente renvoyée par le serveur, en dédoublonnant par `id` puis en
 * triant par date d'envoi croissante. La déduplication par id (plutôt qu'une
 * simple concaténation) protège contre un chevauchement entre les deux
 * listes : la page "récente" glisse à chaque actualisation (nouveau message
 * envoyé/reçu), donc son message le plus ancien peut très bien être déjà
 * présent dans `messagesAnciens` selon le moment où chaque page a été
 * demandée.
 *
 * @param {Array<{id: string}>} messagesAnciens
 * @param {Array<{id: string}>} messagesRecents
 * @param {string} champDate Nom du champ date sur ces messages ('date' pour
 *   un salon, 'envoi' pour une conversation privée — voir fusionnerHistorique
 *   dans message-prive.js pour l'équivalent DM).
 */
function fusionnerHistorique(messagesAnciens, messagesRecents, champDate) {
  const parId = new Map();
  [...messagesAnciens, ...messagesRecents].forEach((message) => {
    parId.set(message.id, message);
  });
  return Array.from(parId.values()).sort((a, b) => a[champDate] - b[champDate]);
}

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

/**
 * Crée un élément DOM avec ses attributs, son contenu texte et ses enfants.
 * Petite fabrique pour éviter la répétition de document.createElement / for
 * loops dans chaque gabarit, sans jamais passer par innerHTML.
 *
 * @param {string} tag
 * @param {{classe?: string, texte?: string, attrs?: Record<string,string>, dataset?: Record<string,string>, enfants?: (Node|null|undefined)[]}} [options]
 */
function creerEl(tag, options = {}) {
  const { classe, texte, attrs, dataset, enfants } = options;
  const element = document.createElement(tag);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  if (attrs) {
    for (const [nom, valeur] of Object.entries(attrs)) {
      element.setAttribute(nom, valeur);
    }
  }
  if (dataset) {
    for (const [cle, valeur] of Object.entries(dataset)) {
      element.dataset[cle] = valeur;
    }
  }
  if (enfants) {
    for (const enfant of enfants) {
      if (enfant) element.appendChild(enfant);
    }
  }
  return element;
}

// Icône de cadenas en SVG : l'emoji 🔒 ne s'affiche pas de façon fiable dans
// Electron selon les polices installées sur le système (tofu box). Un SVG
// inline s'affiche toujours, quelle que soit la plateforme. Construite via
// createElementNS (jamais de chaîne HTML) ; un nœud DOM ne pouvant vivre
// qu'à un seul endroit à la fois, on en fabrique un nouveau à chaque appel.
function creerIconeCadenas() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icone-cadenas');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute(
    'd',
    'M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z'
  );
  svg.appendChild(path);
  return svg;
}

// Icône de main qui salue, même logique que creerIconeCadenas ci-dessus :
// l'emoji 👋 est lui aussi une tofu box sur certains systèmes (voir le
// signalement dans #22), donc on le remplace par ce SVG inline plutôt que
// de dépendre d'une police d'émojis installée sur la machine.
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

// Table des emoji connus pour ne pas s'afficher de façon fiable en Electron
// (tofu box) et remplacés par un SVG inline équivalent. Étendre cette table
// (plutôt que d'ajouter du texte emoji brut ailleurs) si d'autres emoji sont
// utilisés plus tard dans les messages.
const EMOJI_VERS_ICONE = { '👋': creerIconeMain };

/**
 * Remplit `element` avec le texte d'un message, en remplaçant au passage
 * tout emoji connu de EMOJI_VERS_ICONE par son icône SVG (voir
 * creerIconeCadenas/creerIconeMain) : le reste du texte passe par
 * createTextNode, donc aucun risque XSS (jamais d'innerHTML).
 */
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

/**
 * Remplit un élément avec l'icône (salon privé) ou "#" (salon public) suivi
 * du nom du salon. Le NOM du salon lui-même (ex. "général") est une donnée
 * saisie par un utilisateur — il n'est jamais traduit, seul le "#"/cadenas
 * qui l'entoure est de l'UI.
 */
function remplirLabelSalon(element, salon) {
  if (salon.visibilite === 'prive') {
    element.replaceChildren(
      creerIconeCadenas(),
      document.createTextNode(` ${salon.nom}`)
    );
  } else {
    element.replaceChildren(document.createTextNode(`# ${salon.nom}`));
  }
}

function notifier(message, erreur = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', erreur);
  el.toast.classList.add('visible');
  window.setTimeout(() => el.toast.classList.remove('visible'), 2600);
}

function remplirSelectUtilisateur(utilisateurs) {
  const options = utilisateurs.map((item) =>
    creerEl('option', {
      texte: item.pseudo,
      attrs: { value: item.id },
    })
  );
  el.utilisateur.replaceChildren(...options);
}

/**
 * Ouvre la boîte de dialogue générique avec un titre et un contenu.
 * @param {string} titre
 * @param {Node|Node[]} contenu Un nœud DOM déjà construit, ou une liste de nœuds frères.
 */
function ouvrirDialogue(titre, contenu) {
  el.titreDialogue.textContent = titre;
  el.contenuDialogue.replaceChildren(
    ...(Array.isArray(contenu) ? contenu : [contenu])
  );
  el.dialogue.showModal();
}

/**
 * Ajoute l'utilisateur courant à la liste déroulante de test s'il n'y
 * figure pas déjà (ex. un nouvel utilisateur créé via l'écran de
 * connexion, absent des <option> statiques du HTML), et synchronise la
 * sélection affichée.
 */
function synchroniserSelecteurUtilisateur() {
  if (!el.utilisateur) return;
  const dejaPresent = Array.from(el.utilisateur.options).some(
    (option) => option.value === utilisateurActuelId
  );
  if (!dejaPresent) {
    const info = utilisateur(utilisateurActuelId);
    el.utilisateur.appendChild(
      creerEl('option', {
        texte: info?.pseudo ?? utilisateurActuelId,
        attrs: { value: utilisateurActuelId },
      })
    );
  }
  el.utilisateur.value = utilisateurActuelId;
}

async function actualiser() {
  try {
    etat = await window.electronAPI.obtenirEtatSalons(utilisateurActuelId);
    if (!etat.salons.some((salon) => salon.id === salonActifId)) {
      salonActifId = etat.salons[0]?.id ?? null;
    }
    afficherTout();
  } catch (erreur) {
    console.error('[actualiser] ERREUR:', erreur);
    notifier(messageErreur(erreur), true);
  }
  // Note : mettreAJourBadgeApplication() n'est PAS rappelée ici, elle est
  // déjà déclenchée par afficherTout() (voir plus bas) sur le chemin de
  // succès. Un appel ici en plus doublait le recalcul du badge (et l'appel
  // IPC obtenirConversationsPrivees sous-jacent) à chaque actualiser() réussi.
  actualiserBadgeMessagesPrives();
}

/**
 * Recalcule le nombre total de conversations non lues (salons + messages
 * privés) pour l'utilisateur courant, et met à jour le badge de l'icône de
 * l'app en conséquence (voir mettreAJourBadgeApplication côté main.js).
 * Respecte NotifPrefs.afficheRonds() : en mode "aucune", le badge disparaît
 * comme les ronds de notification. Best-effort et silencieux, comme
 * actualiserBadgeMessagesPrives().
 *
 * Le calcul du compte et le dessin de l'icône de badge vivent dans
 * NotifPrefs (notif-prefs.js), partagés avec message-prive.js — voir son
 * en-tête pour le pourquoi (évite la divergence entre deux copies).
 */
async function mettreAJourBadgeApplication() {
  if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
  if (!NotifPrefs.afficheRonds(utilisateurActuelId)) {
    NotifPrefs.appliquerBadge(serviceNotifications, 0);
    return;
  }
  let nombre = NotifPrefs.compterSalonsNonLus(utilisateurActuelId, etat.salons);
  try {
    const conversations =
      await window.electronAPI.obtenirConversationsPrivees(utilisateurActuelId);
    nombre += NotifPrefs.compterConversationsNonLues(
      utilisateurActuelId,
      conversations
    );
  } catch {
    // Badge best-effort, voir commentaire ci-dessus.
  }
  NotifPrefs.appliquerBadge(serviceNotifications, nombre);
}

/**
 * Le bouton d'accès aux messages privés (#message-prive-btn) vit sur CETTE
 * page (index.html) mais doit refléter l'état des conversations privées
 * (autre page). Best-effort et silencieux : un badge qui ne se met pas à
 * jour n'est pas une raison de perturber le reste de l'app.
 */
async function actualiserBadgeMessagesPrives() {
  const dots = document.querySelectorAll('#message-prive-btn .notif-dot');
  if (!dots.length) return;
  if (!NotifPrefs.afficheRonds(utilisateurActuelId)) {
    dots.forEach((dot) => (dot.hidden = true));
    return;
  }
  try {
    const conversations =
      await window.electronAPI.obtenirConversationsPrivees(utilisateurActuelId);
    const nonLu = conversations.some((conversation) =>
      NotifPrefs.estNonLu(
        utilisateurActuelId,
        conversation.id,
        conversation.lastMessage
          ? {
              auteurId: conversation.lastMessage.auteurId,
              timestamp: conversation.lastMessage.envoi,
            }
          : null
      )
    );
    dots.forEach((dot) => (dot.hidden = !nonLu));
  } catch {
    // Badge best-effort, voir commentaire ci-dessus.
  }
}

/** Le dernier message d'un salon, normalisé pour NotifPrefs.estNonLu(). */
function derniereActiviteSalon(salon) {
  if (!salon.messages.length) return null;
  const dernier = salon.messages[salon.messages.length - 1];
  return { auteurId: dernier.auteurId, timestamp: dernier.date };
}

function afficherSalons() {
  el.salons.replaceChildren(
    creerEl('li', { classe: 'category', texte: t('channels.categorySalons') })
  );
  const afficherRonds = NotifPrefs.afficheRonds(utilisateurActuelId);
  let auMoinsUnSalonNonLu = false;

  etat.salons.forEach((salon) => {
    const item = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.className = salon.id === salonActifId ? 'active' : '';
    remplirLabelSalon(bouton, salon);

    const nonLu =
      afficherRonds &&
      NotifPrefs.estNonLu(
        utilisateurActuelId,
        salon.id,
        derniereActiviteSalon(salon)
      );
    if (nonLu) auMoinsUnSalonNonLu = true;
    bouton.appendChild(
      creerEl('span', {
        classe: 'notif-dot notif-dot--channel',
        attrs: nonLu ? {} : { hidden: '' },
      })
    );

    bouton.addEventListener('click', () => {
      salonActifId = salon.id;
      afficherTout();
    });
    item.appendChild(bouton);
    el.salons.appendChild(item);
  });

  document.querySelectorAll('#server-icon-projet .notif-dot').forEach((dot) => {
    dot.hidden = !auMoinsUnSalonNonLu;
  });
}

function creerActionsMessage(message, texteEl) {
  const actions = creerEl('div', { classe: 'message-actions' });
  const modifier = creerEl('button', {
    classe: 'message-action',
    texte: t('messages.edit'),
    attrs: { type: 'button', title: t('messages.edit') },
  });

  modifier.addEventListener('click', () => {
    const contenuInitial = message.contenu;
    const editeur = creerEl('div', { classe: 'message-edit-row' });
    const champ = document.createElement('input');
    champ.className = 'message-edit-input';
    champ.type = 'text';
    champ.value = contenuInitial;
    champ.maxLength = 2000;

    const enregistrer = creerEl('button', {
      classe: 'message-edit-save',
      texte: '✓',
      attrs: { type: 'button', title: t('messages.updated') },
    });
    const annuler = creerEl('button', {
      classe: 'message-edit-cancel',
      texte: '✕',
      attrs: { type: 'button', title: 'Annuler' },
    });

    const restaurer = () => {
      editeur.replaceWith(texteEl);
      actions.hidden = false;
    };

    const sauvegarder = async () => {
      const nouveauContenu = champ.value.trim();
      if (!nouveauContenu || nouveauContenu === contenuInitial) {
        restaurer();
        return;
      }
      enregistrer.disabled = true;
      annuler.disabled = true;
      try {
        await window.electronAPI.modifierMessage({
          messageId: message.id,
          utilisateurId: utilisateurActuelId,
          contenu: nouveauContenu,
        });
        await actualiser();
      } catch (erreur) {
        notifier(messageErreur(erreur), true);
        enregistrer.disabled = false;
        annuler.disabled = false;
        champ.focus();
      }
    };

    enregistrer.addEventListener('click', sauvegarder);
    annuler.addEventListener('click', restaurer);
    champ.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void sauvegarder();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restaurer();
      }
    });

    editeur.append(champ, enregistrer, annuler);
    texteEl.replaceWith(editeur);
    actions.hidden = true;
    champ.focus();
    champ.select();
  });

  const supprimer = creerEl('button', {
    classe: 'message-action',
    texte: t('messages.delete'),
    attrs: { type: 'button', title: t('messages.delete') },
  });

  supprimer.addEventListener('click', async () => {
    if (!window.confirm(t('messages.deleteConfirm'))) return;
    modifier.disabled = true;
    supprimer.disabled = true;
    try {
      await window.electronAPI.supprimerMessage({
        messageId: message.id,
        utilisateurId: utilisateurActuelId,
      });
      notifier(t('messages.deleted'));
      await actualiser();
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
      modifier.disabled = false;
      supprimer.disabled = false;
    }
  });

  actions.append(modifier, supprimer);
  return actions;
}

function afficherMessages(options = {}) {
  const { conserverPositionScroll = false } = options;
  const salon = salonActif();
  if (!salon) {
    el.messages.replaceChildren();
    el.nomSalon.textContent = t('channels.noChannelAccessible');
    el.prive.hidden = true;
    el.message.disabled = true;
    // channels.sendMessagePlaceholder attend un paramètre {name} (voir plus
    // bas) : il n'est donc PAS dans le balayage générique data-i18n-*
    // (appliquerTraductionsStatiques), qui appelle t() sans paramètres.
    // Cette branche doit donc gérer elle-même la traduction du placeholder,
    // sous peine de laisser affiché le texte brut du HTML statique
    // ("Envoyez un message dans #général") tant qu'aucun salon n'est
    // accessible.
    el.message.placeholder = t('channels.noChannelAccessible');
    definirConversationActivePourNotifs(null);
    // Plus aucun salon affiché : l'historique manuellement remonté n'a plus
    // de sens à conserver (voir sa déclaration plus haut).
    etatHistoriqueSalon = {
      salonId: null,
      messagesAnciens: [],
      finHistorique: false,
      enChargement: false,
    };
    return;
  }

  // Changement de salon actif : on repart d'un historique manuel vide (voir
  // la déclaration de etatHistoriqueSalon plus haut). `finHistorique` part de
  // la page récente tout juste reçue (salon.finHistorique, voir
  // construireSalonDTO côté MockGatewayRuntime.js).
  if (etatHistoriqueSalon.salonId !== salon.id) {
    etatHistoriqueSalon = {
      salonId: salon.id,
      messagesAnciens: [],
      finHistorique: Boolean(salon.finHistorique),
      enChargement: false,
    };
  } else if (etatHistoriqueSalon.messagesAnciens.length === 0) {
    // Même salon, mais rien d'ancien encore chargé manuellement : c'est
    // toujours la page récente qui fait foi pour finHistorique (une fois au
    // moins une page plus ancienne chargée, c'est chargerMessagesPlusAnciensSalon
    // qui la met à jour à sa place, voir plus bas).
    etatHistoriqueSalon.finHistorique = Boolean(salon.finHistorique);
  }
  // Le salon affiché est "lu" par l'utilisateur courant — mais SEULEMENT si
  // la fenêtre a effectivement le focus en ce moment (fenetreEstFocusee) :
  // sans ce garde-fou, un message de démo/réel reçu pendant que la fenêtre
  // est en arrière-plan (mais que ce salon était déjà sélectionné) serait
  // marqué "lu" ici alors même qu'une vraie notification système vient
  // d'être déclenchée pour ce même message côté main.js (qui, lui, exige
  // déjà fenetreEstFocusee avant de considérer une conversation comme
  // "déjà lue en direct" — voir showMessageNotification). Les deux
  // indicateurs (rond de notification ici, notification système côté
  // main.js) doivent rester d'accord entre eux.
  if (fenetreEstFocusee) {
    NotifPrefs.marquerCommeLu(utilisateurActuelId, salon.id, Date.now());
  }
  // La conversation "active" que main.js ne doit pas notifier (voir
  // showMessageNotification côté main.js) reste définie qu'on ait le focus
  // ou non : c'est ce salon qui est affiché à l'écran, peu importe si la
  // fenêtre est actuellement au premier plan.
  definirConversationActivePourNotifs(salon.id);
  remplirLabelSalon(el.nomSalon, salon);
  el.prive.hidden = salon.visibilite !== 'prive';
  el.message.disabled = false;
  el.message.placeholder = t('channels.sendMessagePlaceholder', {
    name: salon.nom,
  });

  // Page récente (salon.messages) + historique manuellement remonté (voir
  // chargerMessagesPlusAnciensSalon) : voir fusionnerHistorique plus haut.
  const tousLesMessages = fusionnerHistorique(
    etatHistoriqueSalon.messagesAnciens,
    salon.messages,
    'date'
  );

  // Mémorise la position de défilement AVANT de reconstruire la liste : sans
  // ça, remplacer le contenu de #message-list (replaceChildren) réinitialise
  // implicitement son scroll, ce qui ferait sauter la vue tout en haut à
  // chaque chargement de messages plus anciens (voir conserverPositionScroll
  // ci-dessous et chargerMessagesPlusAnciensSalon).
  const hauteurAvant = el.messages.scrollHeight;
  const scrollAvant = el.messages.scrollTop;

  el.messages.replaceChildren();

  if (!tousLesMessages.length) {
    // Conversation réellement vide (rien à charger, ni de récent ni
    // d'ancien) : la barre d'historique ("Fin de l'historique"/bouton)
    // n'apporte rien de plus que l'état vide ci-dessous, donc on ne l'affiche
    // pas dans ce cas précis.
    el.messages.appendChild(
      creerEl('p', {
        classe: 'empty-state',
        texte: t('channels.noMessages'),
      })
    );
  } else {
    el.messages.appendChild(
      creerStatutHistorique(
        etatHistoriqueSalon,
        chargerMessagesPlusAnciensSalon
      )
    );
    tousLesMessages.forEach((message) => {
      const auteur =
        utilisateur(message.auteurId)?.pseudo ?? t('channels.system');
      const estMessagePersonnel = message.auteurId === utilisateurActuelId;
      const texteEl = creerEl('p', { classe: 'text' });
      remplirTexteMessage(texteEl, message.contenu);
      const article = creerEl('article', {
        classe: estMessagePersonnel ? 'message-row own' : 'message-row',
        enfants: [
          creerEl('div', {
            classe: 'avatar',
            texte: auteur[0].toUpperCase(),
          }),
          creerEl('div', {
            classe: 'message-body',
            enfants: [
              creerEl('div', {
                classe: 'message-meta',
                enfants: [
                  creerEl('span', { classe: 'author', texte: auteur }),
                  creerEl('span', {
                    classe: 'timestamp',
                    // Heure courte (ex. "14:32") plutôt que toLocaleString(),
                    // qui produit une date+heure complète très longue
                    // ("2026-09-07 14 h 32 min 58 s" en fr-CA) : cette
                    // longueur forçait la bulle entière à s'élargir pour
                    // accueillir la ligne meta, même pour un message très
                    // court comme "À plus tard !" (voir #22 - bug rapporté).
                    // On aligne ici sur le format déjà utilisé côté messages
                    // privés (voir timeLabel dans message-prive.js).
                    texte: new Date(message.date).toLocaleTimeString(
                      I18n.obtenirLangue() === 'en' ? 'en-CA' : 'fr-CA',
                      { hour: '2-digit', minute: '2-digit' }
                    ),
                  }),
                  ...(message.modification
                    ? [creerEl('span', { classe: 'edited-label', texte: `(${t('messages.edited')})` })]
                    : []),
                ],
              }),
              texteEl,
            ],
          }),
        ],
      });
      if (estMessagePersonnel) {
        article.querySelector('.message-body')?.appendChild(creerActionsMessage(message, texteEl));
      }
      el.messages.appendChild(article);
    });
  }

  if (conserverPositionScroll) {
    // Charger plus ancien insère du contenu EN HAUT de la liste : on
    // recale le scroll pour que les messages déjà lus restent exactement où
    // ils étaient à l'écran, plutôt que de laisser le navigateur (qui remet
    // scrollTop à 0 après un replaceChildren) faire sauter la vue tout en
    // haut, sur les tout nouveaux messages plus anciens.
    el.messages.scrollTop =
      el.messages.scrollHeight - hauteurAvant + scrollAvant;
  } else {
    el.messages.scrollTop = el.messages.scrollHeight;
  }
}

/**
 * Charge la page de messages plus anciens qui précède ceux déjà affichés
 * pour le salon actif (pagination "charger plus ancien" — voir
 * obtenirMessagesSalonAvant côté MockGatewayRuntime.js), et les fusionne
 * dans etatHistoriqueSalon avant de redemander un rendu qui préserve la
 * position de défilement (voir afficherMessages({ conserverPositionScroll })).
 * Sans effet si un chargement est déjà en cours, si l'historique du salon
 * actif est déjà entièrement remonté, ou si aucun salon n'est actif —
 * appelée aussi bien par le bouton (voir creerStatutHistorique) que par le
 * défilement automatique près du haut de la liste (voir l'écouteur 'scroll'
 * plus bas).
 */
async function chargerMessagesPlusAnciensSalon() {
  const salon = salonActif();
  if (
    !salon ||
    etatHistoriqueSalon.salonId !== salon.id ||
    etatHistoriqueSalon.enChargement ||
    etatHistoriqueSalon.finHistorique
  ) {
    return;
  }

  const plusAncienCharge =
    etatHistoriqueSalon.messagesAnciens[0] ?? salon.messages[0];

  etatHistoriqueSalon.enChargement = true;
  afficherMessages({ conserverPositionScroll: true });

  try {
    const resultat = await window.electronAPI.obtenirMessagesSalonAvant({
      salonId: salon.id,
      utilisateurId: utilisateurActuelId,
      avantId: plusAncienCharge?.id,
    });
    if (etatHistoriqueSalon.salonId !== salon.id) {
      return;
    }
    etatHistoriqueSalon.messagesAnciens = fusionnerHistorique(
      etatHistoriqueSalon.messagesAnciens,
      resultat.messages,
      'date'
    );
    etatHistoriqueSalon.finHistorique = resultat.finHistorique;
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  } finally {
    if (etatHistoriqueSalon.salonId === salon.id) {
      etatHistoriqueSalon.enChargement = false;
      afficherMessages({ conserverPositionScroll: true });
    }
  }
}

// Déclenchement automatique du chargement de l'historique plus ancien en
// s'approchant du haut de la liste (défilement "progressif", en plus du
// bouton explicite — voir creerStatutHistorique) : chargerMessagesPlusAnciensSalon
// est déjà protégée contre les appels superflus (chargement en cours,
// historique déjà épuisé, aucun salon actif), donc pas de garde
// supplémentaire nécessaire ici.
el.messages.addEventListener('scroll', () => {
  if (el.messages.scrollTop < 80) {
    chargerMessagesPlusAnciensSalon();
  }
});

function afficherActions() {
  const salon = salonActif();
  el.inviter.hidden =
    !salon ||
    salon.hoteId !== utilisateurActuelId ||
    salon.visibilite !== 'prive';
  el.membres.disabled = !salon;
  el.compteur.textContent = String(etat.invitations.length);
  el.compteur.hidden = etat.invitations.length === 0;
}

function afficherTout() {
  appliquerTraductionsStatiques();
  synchroniserSelecteurUtilisateur();
  afficherMessages();
  afficherSalons();
  afficherActions();
  mettreAJourBadgeApplication();
  actualiserIndicateurSaisie();
}

// --- Initialisation au démarrage -----
// Un seul appel à actualiser() au démarrage : il se fait via initialiser()
// (plus bas dans ce fichier), qui appelle d'abord initialiserUtilisateurCourant()
// pour résoudre le bon utilisateurActuelId avant de charger l'état des salons.
// Un appel direct à actualiser() ici, en plus, chargeait l'état une première
// fois avec un utilisateurActuelId potentiellement pas encore résolu, avant
// d'être aussitôt écrasé par le second appel (double fetch + flash possible).

el.creer.addEventListener('click', () => {
  const champNom = creerEl('input', { attrs: { maxlength: '40' } });
  const champPrive = creerEl('input', { attrs: { type: 'checkbox' } });
  const boutonConfirmer = creerEl('button', {
    classe: 'primary-button full-width',
    texte: t('channels.create'),
    attrs: { type: 'button' },
  });

  ouvrirDialogue(t('channels.createChannelTitle'), [
    creerEl('label', {
      enfants: [
        document.createTextNode(t('channels.channelNameLabel')),
        champNom,
      ],
    }),
    creerEl('label', {
      classe: 'checkbox-row',
      enfants: [
        champPrive,
        document.createTextNode(` ${t('channels.privateChannelLabel')}`),
      ],
    }),
    boutonConfirmer,
  ]);

  boutonConfirmer.addEventListener('click', async () => {
    try {
      const salon = await window.electronAPI.creerSalon({
        nom: champNom.value,
        prive: champPrive.checked,
        utilisateurId: utilisateurActuelId,
      });
      salonActifId = salon.id;
      el.dialogue.close();
      await actualiser();
      notifier(t('channels.channelCreated'));
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    }
  });
});
el.creerRail.addEventListener('click', () => el.creer.click());

el.inviter.addEventListener('click', () => {
  const salon = salonActif();
  if (!salon) return;
  const candidats = etat.utilisateurs.filter(
    (item) =>
      !salon.membreIds.includes(item.id) &&
      !salon.membresInvites.includes(item.id)
  );

  const titreDialogue = t('channels.inviteInto', { name: salon.nom });

  if (!candidats.length) {
    ouvrirDialogue(
      titreDialogue,
      creerEl('p', {
        classe: 'empty-state',
        texte: t('channels.allUsersAlreadyMembers'),
      })
    );
    return;
  }

  const liste = creerEl('div', { classe: 'choice-list' });
  candidats.forEach((item) => {
    const bouton = creerEl('button', {
      classe: 'user-choice',
      attrs: { type: 'button' },
      dataset: { userId: item.id },
      enfants: [
        document.createTextNode(item.pseudo),
        creerEl('span', { texte: t('channels.invite') }),
      ],
    });
    bouton.addEventListener('click', async () => {
      try {
        await window.electronAPI.inviterAuSalon({
          salonId: salon.id,
          utilisateurId: item.id,
          hoteId: utilisateurActuelId,
        });
        el.dialogue.close();
        await actualiser();
        notifier(t('channels.invitationSent'));
      } catch (erreur) {
        notifier(messageErreur(erreur), true);
      }
    });
    liste.appendChild(bouton);
  });

  ouvrirDialogue(titreDialogue, liste);
});

el.invitations.addEventListener('click', () => {
  if (!etat.invitations.length) {
    ouvrirDialogue(
      t('channels.myInvitations'),
      creerEl('p', {
        classe: 'empty-state',
        texte: t('channels.noInvitationsPending'),
      })
    );
    return;
  }

  const liste = creerEl('div', { classe: 'invitation-list' });
  etat.invitations.forEach((salon) => {
    const boutonAccepter = creerEl('button', {
      classe: 'accept-invite',
      attrs: { type: 'button' },
      texte: t('channels.accept'),
    });
    boutonAccepter.addEventListener('click', () =>
      repondreInvitation(salon.id, true)
    );

    const boutonRefuser = creerEl('button', {
      classe: 'reject-invite',
      attrs: { type: 'button' },
      texte: t('channels.decline'),
    });
    boutonRefuser.addEventListener('click', () =>
      repondreInvitation(salon.id, false)
    );

    const carte = creerEl('div', {
      classe: 'invitation-card',
      enfants: [
        creerEl('div', {
          enfants: [
            creerEl('strong', { texte: `# ${salon.nom}` }),
            creerEl('small', {
              texte: t('channels.invitedBy', {
                host:
                  utilisateur(salon.hoteId)?.pseudo ??
                  t('channels.unknownUser'),
              }),
            }),
          ],
        }),
        creerEl('div', { enfants: [boutonAccepter, boutonRefuser] }),
      ],
    });
    liste.appendChild(carte);
  });

  ouvrirDialogue(t('channels.myInvitations'), liste);
});

async function repondreInvitation(salonId, accepter) {
  try {
    const action = accepter
      ? window.electronAPI.accepterInvitation
      : window.electronAPI.refuserInvitation;
    await action({ salonId, utilisateurId: utilisateurActuelId });
    if (accepter) salonActifId = salonId;
    el.dialogue.close();
    await actualiser();
    notifier(
      accepter
        ? t('channels.invitationAccepted')
        : t('channels.invitationDeclined')
    );
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  }
}

el.membres.addEventListener('click', () => {
  const salon = salonActif();
  if (!salon) return;

  const liste = creerEl('div', { classe: 'member-list' });
  salon.membreIds
    .map((id) => utilisateur(id))
    .filter(Boolean)
    .forEach((membre) => {
      const enfants = [
        creerEl('span', {
          classe: 'avatar small',
          texte: membre.pseudo[0].toUpperCase(),
        }),
        creerEl('span', { texte: membre.pseudo }),
        creerEl('span', {
          classe: 'member-presence',
          texte: (presences[membre.id] ?? 'hors-ligne') === 'en-ligne' ? t('network.online') : t('network.offline'),
          attrs: {
            'data-presence': presences[membre.id] ?? 'hors-ligne',
            'data-user-id': membre.id,
          },
        }),
      ];
      if (membre.id === salon.hoteId) {
        enfants.push(
          creerEl('span', { classe: 'owner-label', texte: t('channels.host') })
        );
      }
      liste.appendChild(creerEl('div', { classe: 'member-row', enfants }));
    });

  ouvrirDialogue(t('channels.membersOf', { name: salon.nom }), liste);
});

el.formulaire.addEventListener('submit', async (event) => {
  event.preventDefault();
  const contenu = el.message.value;
  if (!salonActifId || !contenu.trim()) return;

  const auteurId = utilisateurActuelId;
  const salonId = salonActifId;

  // 1. Annule le timer actif de cet utilisateur s'il existe
  if (timersArretSaisie[auteurId]) {
    clearTimeout(timersArretSaisie[auteurId]);
    delete timersArretSaisie[auteurId];
  }

  // 2. Réinitialise immédiatement l'état de saisie côté backend
  await window.electronAPI.modifierEtatSaisie({
    conversationId: salonId,
    utilisateurId: auteurId,
    est_saisie: false,
  });

  try {
    await window.electronAPI.envoyerMessageSalon({
      salonId,
      utilisateurId: auteurId,
      contenu,
    });
    el.message.value = '';
    await actualiser();
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  }
});

el.utilisateur.addEventListener('change', async (event) => {
  utilisateurActuelId = event.target.value;
  sessionStorage.setItem('currentUserId', utilisateurActuelId);
  // Le brouillon en cours appartenait à l'utilisateur précédent : il ne
  // doit pas apparaître dans le champ de l'utilisateur simulé qu'on vient
  // de sélectionner (voir le même réflexe dans message-prive.js).
  el.message.value = '';
  fermerMenuNotif();
  afficherPresenceCourante();
  await actualiser();
});

if (el.langue) {
  el.langue.addEventListener('change', async (event) => {
    try {
      I18n.definirLangueActuelle(
        await window.electronAPI.definirLangue(event.target.value)
      );
    } catch {
      // Repli silencieux : la langue affichée reste celle d'avant si le
      // canal échoue.
    }
    el.langue.value = I18n.obtenirLangue();
    afficherTout();
    afficherEtatReseau();
    afficherPresenceCourante();
  });
}

async function initialiserUtilisateurCourant() {
  const utilisateurs = await window.electronAPI.obtenirUtilisateurs();
  remplirSelectUtilisateur(utilisateurs);

  if (!utilisateurActuelId) {
    // Pas de sélection déjà mémorisée pour cette session (ex. arrivée sur le
    // dashboard juste après la page de connexion) : on récupère l'utilisateur
    // qui vient de s'y connecter plutôt que de tomber sur le premier
    // utilisateur de la liste par défaut (voir l'incident "connecté en tant
    // qu'alice par défaut" et session:utilisateur-connecte dans main.js).
    utilisateurActuelId = await window.electronAPI.obtenirUtilisateurConnecte();
  }

  utilisateurActuelId =
    utilisateurs.find((item) => item.id === utilisateurActuelId)?.id ??
    utilisateurs[0]?.id ??
    '';
  el.utilisateur.value = utilisateurActuelId;
  sessionStorage.setItem('currentUserId', utilisateurActuelId);
}

async function initialiser() {
  // Dictionnaire, langue courante et langue par défaut : voir
  // I18n.initialiserDepuisElectronAPI (i18n-browser.js) pour le détail
  // (trois canaux IPC indépendants, lancés en parallèle).
  const langue = await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  if (el.langue) el.langue.value = langue;

  try {
    await initialiserUtilisateurCourant();
    await chargerEtatReseauEtPresences();
    // À ce stade, le script s'est déjà mis en pause une fois (l'await
    // ci-dessus), donc le reste du script synchrone du module a fini de
    // s'exécuter — `serviceNotifications`, déclaré plus bas dans le fichier
    // (voir "--- Notifications système ---"), est donc garanti défini ici,
    // comme pour definirConversationActivePourNotifs()/notifierMessageSysteme()
    // qui reposent sur le même ordre d'exécution. On récupère l'état de
    // focus réel AVANT le premier appel à actualiser()/afficherMessages(),
    // pour que la toute première conversation affichée au démarrage ne soit
    // marquée "lue" que si la fenêtre a effectivement le focus à ce moment.
    if (typeof serviceNotifications?.isWindowFocused === 'function') {
      fenetreEstFocusee = Boolean(await serviceNotifications.isWindowFocused());
    }
    // Consomme une éventuelle cible laissée par message-prive.js avant une
    // navigation vers cette page suite au clic sur une notification de
    // salon (voir onNavigateToConversation dans ce fichier et CLEF_CIBLE_SALON).
    const cibleSalon = sessionStorage.getItem(CLEF_CIBLE_SALON);
    if (cibleSalon) {
      sessionStorage.removeItem(CLEF_CIBLE_SALON);
      salonActifId = cibleSalon;
    }
    await actualiser();
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  }
}

initialiser();

const btn = document.getElementById('message-prive-btn');

btn?.addEventListener('click', () => {
  window.electronAPI.navigate('message-prive.html');
});

// --- Notifications système -----------------------------------------------
// Remplace l'ancien câblage basé sur des CustomEvent ('channel:selected',
// 'chat:conversation-selected', 'chat:message-received') qui n'étaient
// jamais émis nulle part dans ce fichier (ils visaient une architecture à
// base de ServiceSalon/src/main.js jamais branchée sur la vraie app — voir
// src/domain/service/ServiceSalon.ts, code mort). Résultat concret : la
// conversation "active" côté main.js n'était jamais mise à jour, et le
// garde-fou anti-notification-sur-conversation-déjà-ouverte ne s'activait
// donc jamais. Câblé maintenant directement aux points réels où le salon
// affiché change (afficherMessages()) et où on envoie/simule un message.
const serviceNotifications = window.notifications;

// Tient fenetreEstFocusee à jour (voir sa déclaration plus haut, et la
// requête initiale dans initialiser()) à partir des changements de focus
// réels côté main.js. Quand la fenêtre regagne le focus alors qu'une
// conversation était déjà affichée (donc jamais marquée "lue" pendant
// qu'elle était en arrière-plan, voir afficherMessages()), on relance
// l'affichage pour la marquer "lue" maintenant qu'elle est effectivement
// visible.
if (typeof serviceNotifications?.onFocusChange === 'function') {
  serviceNotifications.onFocusChange((focused) => {
    const regagneLeFocus = focused && !fenetreEstFocusee;
    fenetreEstFocusee = focused;
    if (regagneLeFocus) {
      afficherTout();
      // afficherTout() ne rafraîchit pas lui-même le rond du bouton
      // #message-prive-btn (voir son propre commentaire) : tous les autres
      // appelants de afficherTout()/actualiser() l'appellent juste après
      // pour cette raison (voir actualiser() et le handler de changement de
      // mode de notif plus bas) — celui-ci l'oubliait, laissant ce rond
      // potentiellement périmé jusqu'au prochain actualiser().
      actualiserBadgeMessagesPrives();
    }
  });
}

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

// Clé sessionStorage utilisée pour transmettre, à travers une navigation
// index.html -> message-prive.html, la conversation privée à ouvrir tout de
// suite après le chargement (voir onNavigateToConversation ci-dessous et sa
// consommation dans initialiser()). sessionStorage est partagé entre les
// deux pages (même origine file://), comme `currentUserId` l'est déjà.
const CLEF_CIBLE_DM = 'notif:cible-dm';
// Symétrique de CLEF_CIBLE_DM, mais dans l'autre sens (portée par
// message-prive.js) : présente ici seulement pour la consommer au retour
// vers cette page (voir initialiser()).
const CLEF_CIBLE_SALON = 'notif:cible-salon';

// Clic sur une notification système (voir showMessageNotification dans
// main.js) : ouvre directement la conversation concernée plutôt que de se
// contenter de remettre la fenêtre au premier plan. Si c'est un salon, on
// est déjà sur la bonne page (index.html) ; si c'est une conversation
// privée, on mémorise la cible et on navigue vers message-prive.html, qui
// la consommera à son chargement.
if (typeof serviceNotifications?.onNavigateToConversation === 'function') {
  serviceNotifications.onNavigateToConversation((cible) => {
    const conversationId = cible?.conversationId;
    if (!conversationId) return;
    if (cible.type === 'salon') {
      salonActifId = conversationId;
      afficherTout();
    } else if (cible.type === 'prive') {
      sessionStorage.setItem(CLEF_CIBLE_DM, conversationId);
      window.electronAPI.navigate('message-prive.html');
    }
  });
}

// --- Messages de démo simulés en continu par main.js ------------------------
// Voir demarrerSimulationMessages() dans main.js : un message privé
// (ariane → sam) toutes les 5s et un message dans #général toutes les 10s,
// en continu, pour pouvoir observer les notifications sans action manuelle.
// C'est ce fichier (pas main.js) qui décide, selon le mode NotifPrefs de
// l'utilisateur actuellement affiché ici, s'il faut déclencher une
// notification système — main.js ne connaît pas les préférences par
// utilisateur (elles vivent dans localStorage, côté renderer).
// Corps du handler partagé avec message-prive.js via
// NotifPrefs.traiterMessageSimule (voir notif-prefs.js) : seule la partie
// "quoi rafraîchir à l'écran" diffère réellement d'une page à l'autre.
if (typeof serviceNotifications?.onMockMessage === 'function') {
  serviceNotifications.onMockMessage((message) =>
    NotifPrefs.traiterMessageSimule(message, {
      utilisateurId: utilisateurActuelId,
      surSalon: () => actualiser(),
      surPrive: async () => {
        await actualiserBadgeMessagesPrives();
        mettreAJourBadgeApplication();
      },
      notifierMessageSysteme,
    })
  );
}

// --- Menu de préférences de notification ----------------------------------
const elNotifBtn = document.querySelector('#open-notif-settings');
const elNotifMenu = document.querySelector('#notif-menu');

function fermerMenuNotif() {
  if (!elNotifMenu || elNotifMenu.hidden) return;
  elNotifMenu.hidden = true;
  elNotifBtn?.setAttribute('aria-expanded', 'false');
}

function ouvrirMenuNotif() {
  if (!elNotifMenu) return;
  const modeActuel = NotifPrefs.obtenirMode(utilisateurActuelId);
  elNotifMenu.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.checked = radio.value === modeActuel;
  });
  elNotifMenu.hidden = false;
  elNotifBtn?.setAttribute('aria-expanded', 'true');
}

elNotifBtn?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (elNotifMenu?.hidden === false) {
    fermerMenuNotif();
  } else {
    ouvrirMenuNotif();
  }
});

elNotifMenu?.addEventListener('click', (event) => event.stopPropagation());

elNotifMenu?.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    NotifPrefs.definirMode(utilisateurActuelId, radio.value);
    fermerMenuNotif();
    afficherTout();
    actualiserBadgeMessagesPrives();
    notifier(t('notifications.preferenceUpdated'));
  });
});

document.addEventListener('click', fermerMenuNotif);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerMenuNotif();
});

// --- Indicateur "en train d'écrire" (salons) ------------------------------
// Contrairement aux DM (une seule autre personne possible), un salon peut
// avoir plusieurs personnes qui écrivent en même temps — d'où la logique de
// jonction de noms ci-dessous (un seul, deux, ou "un + N autres").
let etatsSaisieSalon = [];

const elTypingIndicator = document.getElementById('typing-indicator');
const elIsTypingNom = document.getElementById('is-typing-nom');

async function actualiserIndicateurSaisie() {
  if (!salonActifId) {
    if (elTypingIndicator) elTypingIndicator.hidden = true;
    return;
  }

  try {
    const etats = await window.electronAPI.obtenirEtatsSaisie(salonActifId);
    etatsSaisieSalon = Array.isArray(etats) ? etats : [];

    const autresQuiEcrivent = etatsSaisieSalon.filter(
      (item) =>
        item.utilisateurId !== utilisateurActuelId && item.est_saisie === true
    );

    if (!elTypingIndicator) return;

    if (autresQuiEcrivent.length > 0) {
      const noms = autresQuiEcrivent
        .map(
          (item) =>
            utilisateur(item.utilisateurId)?.pseudo ?? t('typing.someone')
        )
        .filter(Boolean);

      if (elIsTypingNom) {
        if (noms.length === 1) {
          elIsTypingNom.textContent = noms[0];
        } else if (noms.length === 2) {
          elIsTypingNom.textContent = `${noms[0]}${t('typing.and')}${noms[1]}`;
        } else {
          elIsTypingNom.textContent = `${noms[0]}${t('typing.andOthers', { count: noms.length - 1 })}`;
        }
      }

      elTypingIndicator.hidden = false;
      elTypingIndicator.style.setProperty('display', 'flex', 'important');
    } else {
      elTypingIndicator.hidden = true;
      elTypingIndicator.style.setProperty('display', 'none', 'important');
    }
  } catch (err) {
    console.error('[actualiserIndicateurSaisie] Erreur:', err);
  }
}

setInterval(async () => {
  await actualiserIndicateurSaisie();
}, 1500);

const timersArretSaisie = {};

el.message.addEventListener('input', async (event) => {
  const aDuTexte = event.target.value.trim().length > 0;
  const auteurId = utilisateurActuelId;
  const salonId = salonActifId;

  if (!auteurId || !salonId) return;

  // Annule uniquement le timer actif DE CET UTILISATEUR précis
  if (timersArretSaisie[auteurId]) {
    clearTimeout(timersArretSaisie[auteurId]);
    delete timersArretSaisie[auteurId];
  }

  if (aDuTexte) {
    await window.electronAPI.modifierEtatSaisie({
      conversationId: salonId,
      utilisateurId: auteurId,
      est_saisie: true,
    });

    // Programme l'arrêt pour cet utilisateur
    timersArretSaisie[auteurId] = setTimeout(async () => {
      delete timersArretSaisie[auteurId];
      await window.electronAPI.modifierEtatSaisie({
        conversationId: salonId,
        utilisateurId: auteurId,
        est_saisie: false,
      });
      // Force une mise à jour immédiate si ce salon est toujours affiché
      await actualiserIndicateurSaisie();
    }, 10000);
  } else {
    await window.electronAPI.modifierEtatSaisie({
      conversationId: salonId,
      utilisateurId: auteurId,
      est_saisie: false,
    });
    await actualiserIndicateurSaisie();
  }
});


if (el.couperReseau) {
  el.couperReseau.addEventListener('click', async () => {
    try { await window.electronAPI.simulerCoupureReseau(); }
    catch (erreur) { notifier(messageErreur(erreur), true); }
  });
}
if (el.reconnecterReseau) {
  el.reconnecterReseau.addEventListener('click', async () => {
    try { await window.electronAPI.simulerReconnexionReseau(900); }
    catch (erreur) { notifier(messageErreur(erreur), true); }
  });
}
if (el.presenceCourante) {
  el.presenceCourante.addEventListener('click', async () => {
    if (etatReseau.statut !== 'connecte') return;
    const actuelle = presences[utilisateurActuelId] ?? 'hors-ligne';
    const prochaine = actuelle === 'en-ligne' ? 'hors-ligne' : 'en-ligne';
    try { await window.electronAPI.modifierPresence(utilisateurActuelId, prochaine); }
    catch (erreur) { notifier(messageErreur(erreur), true); }
  });
}

window.electronAPI.onEtatReseauChange((nouvelEtat) => afficherEtatReseau(nouvelEtat));
window.electronAPI.onPresenceChange((presence) => {
  presences[presence.utilisateurId] = presence.statut;
  afficherPresenceCourante();

  const presenceMembre = el.dialogue?.querySelector(
    `.member-presence[data-user-id="${presence.utilisateurId}"]`
  );
  if (presenceMembre) {
    presenceMembre.dataset.presence = presence.statut;
    presenceMembre.textContent =
      presence.statut === 'en-ligne' ? t('network.online') : t('network.offline');
  }
});

window.electronAPI.onMessageModifieChange(async () => {
  await actualiser();
});

window.electronAPI.onMessageSupprimeChange(async () => {
  await actualiser();
});
