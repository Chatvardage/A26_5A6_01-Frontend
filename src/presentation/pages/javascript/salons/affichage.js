// salons/affichage.js — Rendu : outils DOM, libellés, liste des salons, messages, actions, badges.
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).

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

/** Nom affiché d'un salon : traduit pour les salons par défaut du serveur
 * « Chatvardage » (voir LogiqueInterface.cleNomSalon), sinon le nom saisi
 * par l'utilisateur, tel quel. */
function nomSalon(salon) {
  const cle = LogiqueInterface.cleNomSalon(salon);
  return cle ? t(cle) : salon.nom;
}

/** Contenu affiché d'un message : le message de bienvenue est traduit tant
 * qu'il n'a pas été modifié (voir LogiqueInterface.cleContenuMessage). */
function contenuMessage(message) {
  const cle = LogiqueInterface.cleContenuMessage(message);
  return cle ? t(cle) : message.contenu;
}

/**
 * Remplit un élément avec l'icône (salon privé) ou "#" (salon public) suivi
 * du nom du salon (voir nomSalon).
 */
function remplirLabelSalon(element, salon) {
  if (salon.visibilite === 'prive') {
    element.replaceChildren(
      creerIconeCadenas(),
      document.createTextNode(` ${nomSalon(salon)}`)
    );
  } else {
    element.replaceChildren(document.createTextNode(`# ${nomSalon(salon)}`));
  }
}

function notifier(message, erreur = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', erreur);
  el.toast.classList.add('visible');
  window.setTimeout(() => el.toast.classList.remove('visible'), 2600);
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
 * Affiche l'utilisateur connecté (pseudo en lecture seule + badge de rôle) :
 * une seule identité par session (le compte JWT, voir
 * initialiserUtilisateurCourant).
 */
function afficherUtilisateurCourant() {
  if (el.utilisateurPseudo) {
    // L'alias (nom d'affichage choisi dans le profil) remplace le pseudo
    // s'il est défini ; le pseudo reste visible au survol.
    const pseudo = utilisateurActuel?.pseudo ?? '';
    el.utilisateurPseudo.textContent = preferences?.alias || pseudo;
    el.utilisateurPseudo.title = preferences?.alias ? `@${pseudo}` : '';
  }
  afficherPresenceCourante();
  if (el.utilisateurRoleBadge) {
    // Rôle dans le serveur affiché (l'admin global reste « Admin »).
    const role = roleActuel();
    const cleRole =
      role === 'admin'
        ? 'channels.roleAdmin'
        : role === 'proprietaire'
          ? 'servers.roleOwner'
          : role === 'moderateur'
            ? 'channels.roleModerator'
            : null;
    el.utilisateurRoleBadge.hidden = !cleRole;
    el.utilisateurRoleBadge.textContent = cleRole ? t(cleRole) : '';
    el.utilisateurRoleBadge.title = cleRole ? t(cleRole) : '';
  }
}

/** Affiche un autre serveur (clic sur son icône du rail). */
async function changerServeur(serveurId) {
  if (serveurId === serveurActifId) return;
  serveurActifId = serveurId;
  salonActifId = null;
  await actualiser();
}

async function actualiser(options = {}) {
  try {
    etat = await window.electronAPI.obtenirEtatSalons({
      serveurId: serveurActifId,
      salonId: salonActifId,
    });
    etatCharge = true;
    serveurActifId = etat.serveurActif?.id ?? null;
    ecrireStockage(localStorage, CLEF_SERVEUR_ACTIF, serveurActifId);
    if (!etat.salons.some((salon) => salon.id === salonActifId)) {
      salonActifId = etat.salons[0]?.id ?? null;
    }
    afficherTout(options);
  } catch (erreur) {
    console.error('[actualiser] ERREUR:', erreur);
    notifier(messageErreur(erreur), true);
  }
  // Note : mettreAJourBadgeApplication() n'est PAS rappelée ici, elle est
  // déjà déclenchée par afficherTout() (voir plus bas) sur le chemin de
  // succès.
  actualiserBadgeMessagesPrives();
}

/**
 * Badge de l'icône de l'app : total des messages non lus (salons + messages
 * privés, compteurs tenus par Message-Service, voir NotifPrefs). Masqué en
 * mode de notification « aucune », comme les compteurs.
 */
function mettreAJourBadgeApplication() {
  if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
  NotifPrefs.appliquerBadge(
    serviceNotifications,
    NotifPrefs.afficheRonds(utilisateurActuelId) ? NotifPrefs.totalNonLus() : 0
  );
}

/**
 * Rond du bouton des messages privés (#message-prive-btn) : au moins un
 * message privé non lu.
 */
function actualiserBadgeMessagesPrives() {
  const nonLu =
    NotifPrefs.afficheRonds(utilisateurActuelId) &&
    NotifPrefs.totalNonLus({ type: 'prive' }) > 0;
  document
    .querySelectorAll('#message-prive-btn .notif-dot')
    .forEach((dot) => (dot.hidden = !nonLu));
}

/** Serveurs du rail ayant au moins un salon non lu. */
function serveursAvecNonLus() {
  if (!NotifPrefs.afficheRonds(utilisateurActuelId)) return new Set();
  return new Set(
    etat.serveurs
      .filter(
        (serveur) =>
          NotifPrefs.totalNonLus({
            type: 'salon',
            conversationIds: serveur.salonIds ?? [],
          }) > 0
      )
      .map((serveur) => serveur.id)
  );
}

function afficherSalons() {
  el.salons.replaceChildren(
    creerEl('li', { classe: 'category', texte: t('channels.categorySalons') })
  );
  const afficherRonds = NotifPrefs.afficheRonds(utilisateurActuelId);

  etat.salons.forEach((salon) => {
    const item = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.className = salon.id === salonActifId ? 'active' : '';
    remplirLabelSalon(bouton, salon);

    const compteur = creerEl('span', {
      classe: 'notif-count notif-count--channel',
    });
    NotifPrefs.remplirCompteur(
      compteur,
      NotifPrefs.nombreNonLus('salon', salon.id),
      afficherRonds
    );
    bouton.appendChild(compteur);

    bouton.addEventListener('click', () => {
      salonActifId = salon.id;
      afficherTout();
    });
    item.appendChild(bouton);
    el.salons.appendChild(item);
  });

  if (el.nomServeur) el.nomServeur.textContent = etat.serveurActif?.nom ?? '';
  if (!etatCharge) return;
  const pastilles = serveursAvecNonLus();
  ChatUiShared.afficherRailServeurs({
    conteneur: el.rail,
    avant: el.creerRail,
    serveurs: etat.serveurs,
    serveurActifId,
    nonLus: pastilles,
    surChoix: (serveur) => changerServeur(serveur.id),
  });
}

function creerActionsMessage(message, texteEl, peutModifier = true) {
  return ChatUiShared.creerActionsMessage({
    peutModifier,
    message,
    texteEl,
    api: window.electronAPI,
    utilisateurId: () => utilisateurActuelId,
    t,
    notifier,
    messageErreur,
    champMessage: el.message,
    getEtatReseau: () => etatReseau,
  });
}

function afficherMessages(options = {}) {
  // conserverPositionScroll : contenu inséré EN HAUT (historique plus
  // ancien), la vue est recalée pour ne pas bouger. garderScroll : contenu
  // ajouté EN BAS (message reçu), la position est gardée telle quelle. Sinon :
  // défilement tout en bas.
  const { conserverPositionScroll = false, garderScroll = false } = options;
  const salon = salonActif();
  if (!salon) {
    el.messages.replaceChildren();
    el.nomSalon.textContent = t('channels.noChannelAccessible');
    el.prive.hidden = true;
    el.message.disabled = true;
    if (el.envoyer) el.envoyer.disabled = true;
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
  // RealGatewayRuntime.js).
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
    NotifPrefs.marquerLu(window.electronAPI, 'salon', salon.id);
  }
  // La conversation "active" que main.js ne doit pas notifier (voir
  // showMessageNotification côté main.js) reste définie qu'on ait le focus
  // ou non : c'est ce salon qui est affiché à l'écran, peu importe si la
  // fenêtre est actuellement au premier plan.
  definirConversationActivePourNotifs(salon.id);
  remplirLabelSalon(el.nomSalon, salon);
  el.prive.hidden = salon.visibilite !== 'prive';
  // Le champ de saisie reste actif même hors ligne (voir ChatUiShared.
  // afficherEtatReseau, qui ne le désactive plus que si aucun salon n'est
  // sélectionné) : un message tapé sans connexion est affiché comme "non
  // livré" avec réessayer/supprimer plutôt que d'empêcher la saisie.
  // On rappelle explicitement afficherEtatReseau() ici : salonActifId vient
  // tout juste d'être fixé par actualiser() (voir plus haut dans ce
  // fichier), donc composerAutorise — calculé à partir de salonActifId —
  // n'a encore jamais été recalculé avec CE salon. Sans cet appel, le
  // premier chargerEtatReseauEtPresences() au démarrage (voir initialiser())
  // a déjà figé messageInput/submitButton sur `disabled = true` (aucun salon
  // actif à ce moment-là), et rien ne les réactivait plus jamais ensuite.
  afficherEtatReseau();
  el.message.placeholder = salon.peutEcrire
    ? t('channels.sendMessagePlaceholder', { name: nomSalon(salon) })
    : t('channels.readOnlyPlaceholder');

  // Page récente (salon.messages) + historique manuellement remonté (voir
  // chargerMessagesPlusAnciensSalon) : voir fusionnerHistorique plus haut.
  // Les messages non livrés du salon (voir messagesEnAttenteSalon) sont
  // fusionnés puis triés avec le reste par `date` plutôt que simplement
  // ajoutés à la suite : ils ne sont PAS garantis d'être les plus récents —
  // actualiser() peut faire apparaître un message réel plus récent pendant
  // qu'un brouillon plus ancien est toujours en attente (ou en cours de
  // renvoi), et deux messages en attente peuvent être retentés dans le
  // désordre. Un simple append donnerait alors un ordre chronologiquement
  // faux.
  const messagesEnAttenteDuSalon = obtenirMessagesEnAttenteSalon(salon.id);
  const messagesHistorique = fusionnerHistorique(
    etatHistoriqueSalon.messagesAnciens,
    salon.messages,
    'date'
  );
  // fusionnerHistorique() renvoie déjà un tableau trié par date : pas besoin
  // de re-trier l'ensemble à chaque rendu quand il n'y a aucun message en
  // attente (le cas de loin le plus fréquent). Quand il y en a, on fusionne
  // au lieu de tout retrier (voir fusionnerAvecMessagesEnAttente) : sinon
  // TOUT l'historique du salon serait retrié à chaque rendu tant qu'un seul
  // brouillon reste en attente — y compris pour des rendus qui n'ont rien à
  // voir avec lui (indicateur de saisie, etc.).
  const tousLesMessages = fusionnerAvecMessagesEnAttente(
    messagesHistorique,
    messagesEnAttenteDuSalon,
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
        ChatUiShared.nomAffiche(utilisateur(message.auteurId)) ||
        t('channels.system');
      const estMessagePersonnel = message.auteurId === utilisateurActuelId;
      const texteEl = creerEl('p', { classe: 'text' });
      remplirTexteMessage(texteEl, contenuMessage(message));
      const classesRow = ['message-row'];
      if (estMessagePersonnel) classesRow.push('own');
      if (message.nonLivre) classesRow.push('non-livre');
      const avatarAuteur = creerEl('div', {
        classe: 'avatar',
        texte: auteur[0].toUpperCase(),
      });
      // Sa propre photo vient des préférences (à jour en direct), celle des
      // autres du profil public chargé par le gateway.
      ChatUiShared.remplirAvatar(
        avatarAuteur,
        estMessagePersonnel
          ? preferences?.avatar
          : utilisateur(message.auteurId)?.avatar
      );
      const article = creerEl('article', {
        classe: classesRow.join(' '),
        enfants: [
          avatarAuteur,
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
                    ? [
                        creerEl('span', {
                          classe: 'edited-label',
                          texte: `(${t('messages.edited')})`,
                        }),
                      ]
                    : []),
                ],
              }),
              texteEl,
            ],
          }),
        ],
      });
      if (message.nonLivre) {
        article
          .querySelector('.message-body')
          ?.appendChild(creerActionsMessageNonLivre(message));
      } else if (
        estMessagePersonnel ||
        // Un modérateur du serveur (ou son propriétaire, un admin) peut
        // supprimer le message d'un autre, pas le modifier.
        ChatUiShared.peutModererServeur(roleActuel())
      ) {
        article
          .querySelector('.message-body')
          ?.appendChild(
            creerActionsMessage(message, texteEl, estMessagePersonnel)
          );
      }
      el.messages.appendChild(article);
    });
  }

  if (garderScroll) {
    el.messages.scrollTop = scrollAvant;
  } else if (conserverPositionScroll) {
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
 * obtenirMessagesSalonAvant côté RealGatewayRuntime.js), et les fusionne
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
  const serveur = etat.serveurActif;
  const role = roleActuel();
  // Inviter : modérateur minimum (même règle que Room-Service), jamais dans
  // Chatvardage (tout le monde y est déjà).
  el.inviter.hidden =
    !serveur || serveur.parDefaut || !ChatUiShared.peutModererServeur(role);
  el.membres.disabled = !serveur;
  el.compteur.textContent = String(etat.invitations.length);
  el.compteur.hidden = etat.invitations.length === 0;

  // Créer / paramétrer un salon : modérateur du serveur minimum. Masqués
  // plutôt que désactivés, pour ne pas proposer une action qui échouerait.
  if (el.creer) el.creer.hidden = !ChatUiShared.peutModererServeur(role);
  if (el.roomSettings) {
    el.roomSettings.hidden = !salon || !ChatUiShared.peutModererServeur(role);
  }
  // « + » du rail : ajouter un serveur (créer ou rejoindre), pour tous.
  if (el.creerRail) el.creerRail.hidden = false;
  if (el.menuServeur) el.menuServeur.disabled = !serveur;
}

function afficherTout(options = {}) {
  appliquerTraductionsStatiques();
  afficherUtilisateurCourant();
  afficherMessages(options);
  afficherSalons();
  afficherActions();
  mettreAJourBadgeApplication();
  actualiserIndicateurSaisie();
}

// --- Initialisation au démarrage -----
// Un seul appel à actualiser() au démarrage : il se fait via initialiser()
// (salons/session.js, lancé par renderer.js), qui appelle d'abord
// initialiserUtilisateurCourant()
// pour résoudre le bon utilisateurActuelId avant de charger l'état des salons.
// Un appel direct à actualiser() ici, en plus, chargeait l'état une première
// fois avec un utilisateurActuelId potentiellement pas encore résolu, avant
// d'être aussitôt écrasé par le second appel (double fetch + flash possible).
