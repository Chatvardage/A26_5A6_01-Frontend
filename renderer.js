// UI uniquement : toutes les opérations passent par l'API sécurisée du preload.
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
  dialogue: document.querySelector('#app-dialog'),
  titreDialogue: document.querySelector('#dialog-title'),
  contenuDialogue: document.querySelector('#dialog-content'),
  toast: document.querySelector('#toast'),
};

const salonActif = () => etat.salons.find((salon) => salon.id === salonActifId);
const utilisateur = (id) => etat.utilisateurs.find((item) => item.id === id);

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

/** Remplit un élément avec l'icône (salon privé) ou "#" (salon public) suivi du nom. */
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

function messageErreur(erreur) {
  return erreur instanceof Error ? erreur.message : String(erreur);
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
    creerEl('li', { classe: 'category', texte: 'Salons' })
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

function afficherMessages() {
  const salon = salonActif();
  el.messages.replaceChildren();
  if (!salon) {
    el.nomSalon.textContent = 'Aucun salon accessible';
    el.prive.hidden = true;
    el.message.disabled = true;
    definirConversationActivePourNotifs(null);
    return;
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
  el.message.placeholder = `Envoyez un message dans #${salon.nom}`;
  if (!salon.messages.length) {
    el.messages.replaceChildren(
      creerEl('p', {
        classe: 'empty-state',
        texte: 'Aucun message dans ce salon.',
      })
    );
    return;
  }
  salon.messages.forEach((message) => {
    const auteur = utilisateur(message.auteurId)?.pseudo ?? 'Système';
    const estMessagePersonnel = message.auteurId === utilisateurActuelId;
    const article = creerEl('article', {
      classe: estMessagePersonnel ? 'message-row own' : 'message-row',
      enfants: [
        creerEl('div', { classe: 'avatar', texte: auteur[0].toUpperCase() }),
        creerEl('div', {
          classe: 'message-body',
          enfants: [
            creerEl('div', {
              classe: 'message-meta',
              enfants: [
                creerEl('span', { classe: 'author', texte: auteur }),
                creerEl('span', {
                  classe: 'timestamp',
                  texte: new Date(message.date).toLocaleString('fr-CA'),
                }),
              ],
            }),
            creerEl('p', { classe: 'text', texte: message.contenu }),
          ],
        }),
      ],
    });
    el.messages.appendChild(article);
  });
  el.messages.scrollTop = el.messages.scrollHeight;
}

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
  synchroniserSelecteurUtilisateur();
  afficherMessages();
  afficherSalons();
  afficherActions();
  mettreAJourBadgeApplication();
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
    texte: 'Créer',
    attrs: { type: 'button' },
  });

  ouvrirDialogue('Créer un salon', [
    creerEl('label', {
      enfants: [document.createTextNode('Nom du salon'), champNom],
    }),
    creerEl('label', {
      classe: 'checkbox-row',
      enfants: [champPrive, document.createTextNode(' Salon privé')],
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
      notifier('Salon créé.');
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

  if (!candidats.length) {
    ouvrirDialogue(
      `Inviter dans #${salon.nom}`,
      creerEl('p', {
        classe: 'empty-state',
        texte: 'Tous les utilisateurs sont déjà membres ou invités.',
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
        creerEl('span', { texte: 'Inviter' }),
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
        notifier('Invitation envoyée.');
      } catch (erreur) {
        notifier(messageErreur(erreur), true);
      }
    });
    liste.appendChild(bouton);
  });

  ouvrirDialogue(`Inviter dans #${salon.nom}`, liste);
});

el.invitations.addEventListener('click', () => {
  if (!etat.invitations.length) {
    ouvrirDialogue(
      'Mes invitations',
      creerEl('p', {
        classe: 'empty-state',
        texte: 'Tu n\u2019as aucune invitation en attente.',
      })
    );
    return;
  }

  const liste = creerEl('div', { classe: 'invitation-list' });
  etat.invitations.forEach((salon) => {
    const boutonAccepter = creerEl('button', {
      classe: 'accept-invite',
      attrs: { type: 'button' },
      texte: 'Accepter',
    });
    boutonAccepter.addEventListener('click', () =>
      repondreInvitation(salon.id, true)
    );

    const boutonRefuser = creerEl('button', {
      classe: 'reject-invite',
      attrs: { type: 'button' },
      texte: 'Refuser',
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
              texte: `Invité par ${utilisateur(salon.hoteId)?.pseudo ?? 'Inconnu'}`,
            }),
          ],
        }),
        creerEl('div', { enfants: [boutonAccepter, boutonRefuser] }),
      ],
    });
    liste.appendChild(carte);
  });

  ouvrirDialogue('Mes invitations', liste);
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
    notifier(accepter ? 'Invitation acceptée.' : 'Invitation refusée.');
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
      ];
      if (membre.id === salon.hoteId) {
        enfants.push(creerEl('span', { classe: 'owner-label', texte: 'Hôte' }));
      }
      liste.appendChild(creerEl('div', { classe: 'member-row', enfants }));
    });

  ouvrirDialogue(`Membres de #${salon.nom}`, liste);
});

el.formulaire.addEventListener('submit', async (event) => {
  event.preventDefault();
  const contenu = el.message.value;
  if (!salonActifId || !contenu.trim()) return;
  try {
    await window.electronAPI.envoyerMessageSalon({
      salonId: salonActifId,
      utilisateurId: utilisateurActuelId,
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
  fermerMenuNotif();
  await actualiser();
});

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
  try {
    await initialiserUtilisateurCourant();
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
    notifier('Préférence de notification mise à jour.');
  });
});

document.addEventListener('click', fermerMenuNotif);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerMenuNotif();
});

// `index.html` est pour l'instant une
// coquille statique (voir le commentaire en tête de src/presentation/pages/
// index.html). Le rendu des salons/messages/présence, et l'envoi de
// messages via #message-form, arriveront avec le ChatGateway (mock puis
// réel), en ajoutant les méthodes correspondantes à `electronAPI` dans
// preload.js plutôt qu'un accès direct à ipcRenderer.
