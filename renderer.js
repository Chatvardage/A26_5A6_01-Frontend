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

// Icône de cadenas en SVG : l'emoji 🔒 ne s'affiche pas de façon fiable dans
// Electron selon les polices installées sur le système (tofu box). Un SVG
// inline s'affiche toujours, quelle que soit la plateforme.
const ICONE_CADENAS =
  '<svg class="icone-cadenas" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z"/></svg>';

function echapper(texte) {
  const div = document.createElement('div');
  div.textContent = String(texte);
  return div.innerHTML;
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
  el.contenuDialogue.innerHTML = contenu;
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
  el.salons.innerHTML = '<li class="category">Salons</li>';
  etat.salons.forEach((salon) => {
    const item = document.createElement('li');
    const bouton = document.createElement('button');
    bouton.className = salon.id === salonActifId ? 'active' : '';
    bouton.innerHTML = `${salon.visibilite === 'prive' ? ICONE_CADENAS : '#'} ${echapper(salon.nom)}`;
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
  el.messages.innerHTML = '';
  if (!salon) {
    el.nomSalon.textContent = 'Aucun salon accessible';
    el.prive.hidden = true;
    el.message.disabled = true;
    return;
  }
  el.nomSalon.innerHTML = `${salon.visibilite === 'prive' ? ICONE_CADENAS : '#'} ${echapper(salon.nom)}`;
  el.prive.hidden = salon.visibilite !== 'prive';
  el.message.disabled = false;
  el.message.placeholder = `Envoyez un message dans #${salon.nom}`;
  if (!salon.messages.length) {
    el.messages.innerHTML =
      '<p class="empty-state">Aucun message dans ce salon.</p>';
    return;
  }
  salon.messages.forEach((message) => {
    const auteur = utilisateur(message.auteurId)?.pseudo ?? 'Système';
    const estMessagePersonnel = message.auteurId === utilisateurActuelId;
    const article = document.createElement('article');
    article.className = estMessagePersonnel ? 'message-row own' : 'message-row';
    article.innerHTML = `<div class="avatar">${echapper(auteur[0].toUpperCase())}</div><div class="message-body"><div class="message-meta"><span class="author">${echapper(auteur)}</span><span class="timestamp">${new Date(message.date).toLocaleString('fr-CA')}</span></div><p class="text">${echapper(message.contenu)}</p></div>`;
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
  ouvrirDialogue(
    'Créer un salon',
    '<label>Nom du salon<input id="new-channel-name" maxlength="40"></label><label class="checkbox-row"><input id="new-channel-private" type="checkbox"> Salon privé</label><button type="button" id="create-channel-confirm" class="primary-button full-width">Créer</button>'
  );
  document
    .querySelector('#create-channel-confirm')
    .addEventListener('click', async () => {
      try {
        const salon = await window.electronAPI.creerSalon({
          nom: document.querySelector('#new-channel-name').value,
          prive: document.querySelector('#new-channel-private').checked,
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
  ouvrirDialogue(
    `Inviter dans #${salon.nom}`,
    candidats.length
      ? `<div class="choice-list">${candidats.map((item) => `<button type="button" class="user-choice" data-user-id="${echapper(item.id)}">${echapper(item.pseudo)}<span>Inviter</span></button>`).join('')}</div>`
      : '<p class="empty-state">Tous les utilisateurs sont déjà membres ou invités.</p>'
  );
  document.querySelectorAll('.user-choice').forEach((bouton) =>
    bouton.addEventListener('click', async () => {
      try {
        await window.electronAPI.inviterAuSalon({
          salonId: salon.id,
          utilisateurId: bouton.dataset.userId,
          hoteId: utilisateurActuelId,
        });
        el.dialogue.close();
        await actualiser();
        notifier('Invitation envoyée.');
      } catch (erreur) {
        notifier(messageErreur(erreur), true);
      }
    })
  );
});

el.invitations.addEventListener('click', () => {
  ouvrirDialogue(
    'Mes invitations',
    etat.invitations.length
      ? `<div class="invitation-list">${etat.invitations.map((salon) => `<div class="invitation-card"><div><strong># ${echapper(salon.nom)}</strong><small>Invité par ${echapper(utilisateur(salon.hoteId)?.pseudo ?? 'Inconnu')}</small></div><div><button type="button" class="accept-invite" data-salon-id="${echapper(salon.id)}">Accepter</button><button type="button" class="reject-invite" data-salon-id="${echapper(salon.id)}">Refuser</button></div></div>`).join('')}</div>`
      : '<p class="empty-state">Tu n’as aucune invitation en attente.</p>'
  );
  document
    .querySelectorAll('.accept-invite')
    .forEach((bouton) =>
      bouton.addEventListener('click', () =>
        repondreInvitation(bouton.dataset.salonId, true)
      )
    );
  document
    .querySelectorAll('.reject-invite')
    .forEach((bouton) =>
      bouton.addEventListener('click', () =>
        repondreInvitation(bouton.dataset.salonId, false)
      )
    );
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
  const contenu = salon.membreIds
    .map((id) => utilisateur(id))
    .filter(Boolean)
    .map(
      (membre) =>
        `<div class="member-row"><span class="avatar small">${echapper(membre.pseudo[0].toUpperCase())}</span><span>${echapper(membre.pseudo)}</span>${membre.id === salon.hoteId ? '<span class="owner-label">Hôte</span>' : ''}</div>`
    )
    .join('');
  ouvrirDialogue(
    `Membres de #${salon.nom}`,
    `<div class="member-list">${contenu}</div>`
  );
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

actualiser();
