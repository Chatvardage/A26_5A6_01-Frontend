// UI uniquement : toutes les opérations passent par l'API sécurisée du preload.
let utilisateurActuelId = 'u1';
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
  await actualiser();
});

/**
 * Démarre le dashboard avec l'utilisateur réellement connecté via l'écran
 * de connexion (voir main.js, canal 'session:utilisateur-connecte'), au
 * lieu du 'u1' codé en dur. Repli silencieux sur 'u1' si ce canal échoue ou
 * ne retourne rien (ex. dashboard ouvert directement, sans passer par la
 * page de connexion — utile en développement).
 */
async function initialiserUtilisateurCourant() {
  try {
    const id = await window.electronAPI.obtenirUtilisateurConnecte();
    if (id) {
      utilisateurActuelId = id;
    }
  } catch {
    // Repli sur 'u1' (valeur initiale) si le canal échoue.
  }
  await actualiser();
}

initialiserUtilisateurCourant();