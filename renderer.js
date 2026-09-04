// UI uniquement : toutes les opérations passent par l'API sécurisée du preload.
let utilisateurActuelId = sessionStorage.getItem('currentUserId') ?? 'u1';
let salonActifId = null;
let etat = { utilisateurs: [], salons: [], invitations: [] };

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

async function actualiser() {
  try {
    etat = await window.electronAPI.obtenirEtatSalons(utilisateurActuelId);
    if (!etat.salons.some((salon) => salon.id === salonActifId)) {
      salonActifId = etat.salons[0]?.id ?? null;
    }
    afficherTout();
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  }
}

function afficherSalons() {
  el.salons.replaceChildren(
    creerEl('li', { classe: 'category', texte: 'Salons' })
  );
  etat.salons.forEach((salon) => {
    const item = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.className = salon.id === salonActifId ? 'active' : '';
    remplirLabelSalon(bouton, salon);
    bouton.addEventListener('click', () => {
      salonActifId = salon.id;
      afficherTout();
    });
    item.appendChild(bouton);
    el.salons.appendChild(item);
  });
}

function afficherMessages() {
  const salon = salonActif();
  el.messages.replaceChildren();
  if (!salon) {
    el.nomSalon.textContent = 'Aucun salon accessible';
    el.prive.hidden = true;
    el.message.disabled = true;
    return;
  }
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
  // Un salon public n'a pas d'invitations : tout le monde en est déjà membre.
  el.inviter.hidden =
    !salon ||
    salon.hoteId !== utilisateurActuelId ||
    salon.visibilite !== 'prive';
  el.membres.disabled = !salon;
  el.compteur.textContent = String(etat.invitations.length);
  el.compteur.hidden = etat.invitations.length === 0;
}

function afficherTout() {
  afficherSalons();
  afficherMessages();
  afficherActions();
}

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
        texte: 'Tu n’as aucune invitation en attente.',
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
await actualiser();
});

async function initialiserUtilisateurCourant() {
  const utilisateurs = await window.electronAPI.obtenirUtilisateurs();
  remplirSelectUtilisateur(utilisateurs);
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