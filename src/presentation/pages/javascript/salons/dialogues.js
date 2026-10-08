// salons/dialogues.js — Fenêtres : créer un salon ou un serveur, inviter, invitations reçues, membres, paramètres du salon, menu du serveur.
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).

// --- Fenêtres : outils communs --------------------------------------------

/** Exécute `action`, ferme la fenêtre, rafraîchit, affiche `message`. */
async function agir(action, message) {
  try {
    await action();
    el.dialogue.close();
    await actualiser();
    if (message) notifier(message);
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  }
}

function creerBouton(texte, classe, surClic) {
  const bouton = creerEl('button', {
    classe,
    texte,
    attrs: { type: 'button' },
  });
  bouton.addEventListener('click', surClic);
  return bouton;
}

function creerCaseACocher(libelle, coche = false) {
  const champ = creerEl('input', { attrs: { type: 'checkbox' } });
  champ.checked = coche;
  const ligne = creerEl('label', {
    classe: 'checkbox-row',
    enfants: [champ, document.createTextNode(` ${libelle}`)],
  });
  return { champ, ligne };
}

/**
 * Bouton d'action destructive avec confirmation en deux temps (pas de
 * confirm() natif, jamais utilisé dans l'app).
 */
function creerBoutonConfirme(texte, question, surConfirmation) {
  const bouton = creerEl('button', {
    classe: 'secondary-button full-width danger',
    texte,
    attrs: { type: 'button' },
  });
  bouton.addEventListener('click', () => {
    const ligne = creerEl('div', {
      classe: 'confirm-delete-row',
      enfants: [
        creerEl('span', { texte: question }),
        creerBouton(t('messages.cancel'), 'secondary-button', () =>
          ligne.replaceWith(bouton)
        ),
        creerBouton(texte, 'secondary-button danger', surConfirmation),
      ],
    });
    bouton.replaceWith(ligne);
  });
  return bouton;
}

// --- Créer un salon (modérateur du serveur minimum) -------------------------
el.creer.addEventListener('click', () => {
  const serveur = etat.serveurActif;
  if (!serveur) return;
  const champNom = creerEl('input', { attrs: { maxlength: '80' } });
  const reserve = creerCaseACocher(t('channels.moderatorsOnlyLabel'));
  const lectureSeule = creerCaseACocher(t('channels.writeModeratorsLabel'));

  ouvrirDialogue(t('channels.createChannelTitle'), [
    creerEl('label', {
      enfants: [
        document.createTextNode(t('channels.channelNameLabel')),
        champNom,
      ],
    }),
    reserve.ligne,
    lectureSeule.ligne,
    creerBouton(t('channels.create'), 'primary-button full-width', () =>
      agir(async () => {
        const salon = await window.electronAPI.creerSalon({
          serveurId: serveur.id,
          nom: champNom.value,
          acces: reserve.champ.checked ? 'moderateurs' : 'tous',
          ecriture: lectureSeule.champ.checked ? 'moderateurs' : 'tous',
        });
        salonActifId = salon.id;
      }, t('channels.channelCreated'))
    ),
  ]);
});

// --- « + » du rail : créer un serveur ou rejoindre un serveur public --------
el.creerRail.addEventListener('click', () => {
  const champNom = creerEl('input', { attrs: { maxlength: '80' } });
  const public_ = creerCaseACocher(t('servers.publicLabel'));
  const creer = creerBouton(
    t('servers.create'),
    'primary-button full-width',
    () =>
      agir(async () => {
        const serveur = await window.electronAPI.creerServeur({
          nom: champNom.value,
          public: public_.champ.checked,
        });
        serveurActifId = serveur.id;
        salonActifId = null;
      }, t('servers.created'))
  );

  // Recherche de serveurs publics (tous tant que le champ est vide).
  const recherche = creerEl('input', {
    classe: 'dm-search',
    attrs: {
      type: 'search',
      maxlength: '80',
      placeholder: t('servers.searchPlaceholder'),
      'aria-label': t('servers.searchPlaceholder'),
    },
  });
  const liste = creerEl('div', {
    classe: 'choice-list',
    attrs: { 'aria-live': 'polite' },
  });
  // Serveurs publics chargés par pages (Room-Service), « Afficher plus »
  // ajoute la page suivante sous les précédentes.
  const plus = creerBouton(
    t('servers.showMorePublic'),
    'secondary-button full-width',
    () => void chercher(Number(plus.dataset.decalage))
  );
  plus.hidden = true;
  let numero = 0;
  let minuteur = null;
  const ligneServeur = (serveur) => {
    const ligne = creerBouton('', 'user-choice', () =>
      agir(async () => {
        await window.electronAPI.rejoindreServeur(serveur.id);
        serveurActifId = serveur.id;
        salonActifId = null;
      }, t('servers.joined'))
    );
    // Contenu de la ligne (creerBouton ne prend qu'un texte simple).
    ligne.replaceChildren(
      creerEl('span', {
        classe: 'avatar small server-avatar',
        texte: ChatUiShared.initialesServeur(serveur.nom),
      }),
      creerEl('span', {
        classe: 'user-choice-identity',
        enfants: [
          creerEl('strong', { texte: serveur.nom }),
          creerEl('small', {
            texte: t('servers.memberCount', { n: serveur.nombreMembres }),
          }),
        ],
      }),
      creerEl('span', {
        classe: 'user-choice-action',
        texte: t('servers.join'),
      })
    );
    ChatUiShared.remplirAvatar(ligne.firstChild, serveur.icone);
    return ligne;
  };
  const chercher = async (decalage = 0) => {
    const n = ++numero;
    plus.disabled = true;
    if (decalage === 0) {
      plus.hidden = true;
      liste.replaceChildren(
        creerEl('p', { classe: 'empty-state', texte: t('dm.searching') })
      );
    }
    let page;
    try {
      page = await window.electronAPI.decouvrirServeurs({
        texte: recherche.value,
        decalage,
      });
    } catch (erreur) {
      if (n !== numero) return;
      plus.disabled = false;
      if (decalage === 0) {
        liste.replaceChildren(
          creerEl('p', { classe: 'empty-state', texte: messageErreur(erreur) })
        );
      } else {
        notifier(messageErreur(erreur), true);
      }
      return;
    }
    if (n !== numero) return;
    plus.disabled = false;
    plus.hidden = page.suivant === null;
    plus.dataset.decalage = String(page.suivant ?? 0);
    const lignes = page.serveurs.map(ligneServeur);
    if (decalage > 0) {
      liste.append(...lignes);
    } else if (lignes.length) {
      liste.replaceChildren(...lignes);
    } else {
      liste.replaceChildren(
        creerEl('p', { classe: 'empty-state', texte: t('servers.noPublic') })
      );
    }
  };
  recherche.addEventListener('input', () => {
    window.clearTimeout(minuteur);
    minuteur = window.setTimeout(() => void chercher(), 250);
  });
  // Le dialogue est un <form method="dialog"> : Entrée le fermerait.
  recherche.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  champNom.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      creer.click();
    }
  });

  ouvrirDialogue(t('servers.addTitle'), [
    creerEl('p', {
      classe: 'choice-section-title',
      texte: t('servers.createTitle'),
    }),
    creerEl('label', {
      enfants: [document.createTextNode(t('servers.nameLabel')), champNom],
    }),
    public_.ligne,
    creer,
    creerEl('p', {
      classe: 'choice-section-title dialog-section-gap',
      texte: t('servers.discoverTitle'),
    }),
    recherche,
    liste,
    plus,
  ]);
  void chercher();
});

// --- Inviter dans le serveur (tout membre, sauf Chatvardage) ----------------
el.inviter.addEventListener('click', () => {
  const serveur = etat.serveurActif;
  if (!serveur) return;
  // Qui est déjà membre, pour les personnes affichées seulement (la liste
  // complète des membres n'est plus chargée, voir membresParmi).
  const membreIds = new Set();
  const avecAppartenance = async (utilisateurs) => {
    try {
      const membres = await window.electronAPI.membresParmi({
        serveurId: serveur.id,
        ids: utilisateurs.map((user) => user.id),
      });
      for (const id of membres) membreIds.add(id);
    } catch {
      // Best-effort : sans réponse, l'invitation d'un membre est refusée
      // par le serveur.
    }
    return utilisateurs;
  };
  const statutDans = (user) =>
    membreIds.has(user.id)
      ? 'membre'
      : serveur.invitations.includes(user.id)
        ? 'invite'
        : null;

  // Même sélecteur que "Nouveau message privé" (voir
  // ChatUiShared.creerSelecteurUtilisateurs). Les invitations en attente ne
  // sont connues que des modérateurs : pour un simple membre, inviter une
  // personne déjà invitée est sans effet (idempotent côté serveur).
  const selecteur = ChatUiShared.creerSelecteurUtilisateurs({
    t,
    messageErreur,
    obtenirSuggestions: async () =>
      avecAppartenance(await window.electronAPI.obtenirSuggestionsDm()),
    rechercher: async (texte) =>
      avecAppartenance(await window.electronAPI.rechercherUtilisateurs(texte)),
    garderSuggestion: (user) => !statutDans(user),
    decrireAction: (user) => {
      const statut = statutDans(user);
      if (statut === 'membre') {
        return { libelle: t('channels.alreadyMember'), desactive: true };
      }
      if (statut === 'invite') {
        return { libelle: t('channels.alreadyInvited'), desactive: true };
      }
      return { libelle: t('channels.invite') };
    },
    surChoix: (user) =>
      agir(
        () =>
          window.electronAPI.inviterAuServeur({
            serveurId: serveur.id,
            utilisateurId: user.id,
          }),
        t('channels.invitationSent')
      ),
    messageAucuneSuggestion: t('channels.noInviteSuggestions'),
  });

  ouvrirDialogue(t('servers.inviteInto', { name: serveur.nom }), selecteur);
});

// --- Invitations reçues (à des serveurs) ------------------------------------
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
  etat.invitations.forEach((invitation) => {
    const carte = creerEl('div', {
      classe: 'invitation-card',
      enfants: [
        creerEl('div', {
          enfants: [
            creerEl('strong', { texte: invitation.nom }),
            creerEl('small', {
              texte: t('channels.invitedBy', {
                host:
                  ChatUiShared.nomAffiche(utilisateur(invitation.invitePar)) ||
                  t('channels.unknownUser'),
              }),
            }),
          ],
        }),
        creerEl('div', {
          enfants: [
            creerBouton(t('channels.accept'), 'accept-invite', () =>
              repondreInvitation(invitation.id, true)
            ),
            creerBouton(t('channels.decline'), 'reject-invite', () =>
              repondreInvitation(invitation.id, false)
            ),
          ],
        }),
      ],
    });
    liste.appendChild(carte);
  });

  ouvrirDialogue(t('channels.myInvitations'), liste);
});

function repondreInvitation(serveurId, accepter) {
  return agir(
    async () => {
      if (accepter) {
        await window.electronAPI.accepterInvitation({ serveurId });
        serveurActifId = serveurId;
        salonActifId = null;
      } else {
        await window.electronAPI.refuserInvitation({ serveurId });
      }
    },
    accepter
      ? t('channels.invitationAccepted')
      : t('channels.invitationDeclined')
  );
}

// --- Membres du serveur (rôles, nommer modérateur, expulser) -----------------
const CLES_ROLE = {
  proprietaire: 'servers.roleOwner',
  moderateur: 'channels.roleModerator',
};

el.membres.addEventListener('click', () => {
  const serveur = etat.serveurActif;
  if (!serveur) return;
  const monRole = roleActuel();

  // Membres chargés par pages (Room-Service) : propriétaire en tête, puis
  // modérateurs, puis membres. Plus de liste complète avec le serveur.
  const liste = creerEl('div', { classe: 'member-list' });
  const plus = creerBouton(
    t('servers.showMoreMembers'),
    'secondary-button full-width',
    () => chargerPage(Number(plus.dataset.decalage))
  );
  plus.hidden = true;
  const connus = new Map();
  // Membres déjà affichés : candidats pour reprendre la propriété du serveur.
  const charges = [];

  async function chargerPage(decalage) {
    plus.disabled = true;
    try {
      const page = await window.electronAPI.obtenirMembresServeur({
        serveurId: serveur.id,
        decalage,
      });
      for (const u of page.utilisateurs) connus.set(u.id, u);
      for (const { utilisateurId, role } of page.membres) {
        charges.push(utilisateurId);
        liste.appendChild(ligneMembre(utilisateurId, role));
      }
      plus.hidden = page.suivant === null;
      plus.dataset.decalage = String(page.suivant ?? 0);
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    } finally {
      plus.disabled = false;
    }
  }

  function ligneMembre(utilisateurId, role) {
    const membre = connus.get(utilisateurId) ?? {
      id: utilisateurId,
      pseudo: t('channels.unknownUser'),
    };
    const nom = ChatUiShared.nomAffiche(membre);
    const avatarMembre = creerEl('span', {
      classe: 'avatar small member-avatar',
      texte: nom.charAt(0).toUpperCase(),
    });
    ChatUiShared.remplirAvatar(avatarMembre, membre.avatar);

    // Ligne secondaire : présence (texte mis à jour en direct, voir
    // onPresenceChange) et badge de rôle.
    const details = [
      creerEl('span', {
        classe: 'member-presence',
        texte:
          (presences[utilisateurId] ?? 'hors-ligne') === 'en-ligne'
            ? t('network.online')
            : t('network.offline'),
        attrs: {
          'data-presence': presences[utilisateurId] ?? 'hors-ligne',
          'data-user-id': utilisateurId,
        },
      }),
    ];
    if (CLES_ROLE[role]) {
      details.push(
        creerEl('span', {
          classe: `member-role member-role--${role}`,
          texte: t(CLES_ROLE[role]),
        })
      );
    }
    const identite = creerEl('div', {
      classe: 'member-identity',
      enfants: [
        creerEl('span', {
          classe: 'member-name',
          texte:
            utilisateurId === utilisateurActuelId
              ? `${nom} (${t('dm.me')})`
              : nom,
          attrs: membre.alias ? { title: `@${membre.pseudo}` } : {},
        }),
        creerEl('div', { classe: 'member-details', enfants: details }),
      ],
    });

    const actions = [];
    if (utilisateurId !== utilisateurActuelId && role !== 'proprietaire') {
      // Nommer / retirer un modérateur : propriétaire ou admin.
      if (ChatUiShared.peutGererServeur(monRole)) {
        const promouvoir = role === 'membre';
        actions.push(
          creerBouton(
            promouvoir
              ? t('servers.makeModerator')
              : t('servers.removeModerator'),
            'member-action',
            () =>
              agir(
                () =>
                  window.electronAPI.changerRoleMembre({
                    serveurId: serveur.id,
                    utilisateurId,
                    role: promouvoir ? 'moderateur' : 'membre',
                  }),
                t('servers.roleUpdated')
              )
          )
        );
      }
      // Expulser : modérateur minimum, strictement au-dessus du membre.
      if (
        !serveur.parDefaut &&
        ChatUiShared.peutModererServeur(monRole) &&
        ChatUiShared.rangRole(monRole) > ChatUiShared.rangRole(role)
      ) {
        actions.push(
          creerBouton(t('servers.kick'), 'member-action danger', () =>
            agir(
              () =>
                window.electronAPI.expulserMembre({
                  serveurId: serveur.id,
                  utilisateurId,
                }),
              t('servers.kicked')
            )
          )
        );
      }
    }
    // Expulser le propriétaire : administrateur seulement, qui choisit le
    // membre qui reprend le serveur (Room-Service exige ce successeur).
    if (
      role === 'proprietaire' &&
      monRole === 'admin' &&
      !serveur.parDefaut &&
      utilisateurId !== utilisateurActuelId
    ) {
      actions.push(
        creerBouton(t('servers.kick'), 'member-action danger', () =>
          choisirNouveauProprietaire(utilisateurId, nom)
        )
      );
    }
    const enfants = [avatarMembre, identite];
    if (actions.length > 0) {
      enfants.push(
        creerEl('div', { classe: 'member-actions', enfants: actions })
      );
    }
    return creerEl('div', { classe: 'member-row', enfants });
  }

  function choisirNouveauProprietaire(proprietaireId, nomProprietaire) {
    const candidats = charges.filter((id) => id !== proprietaireId);
    const choix = creerEl('div', { classe: 'choice-list' });
    choix.replaceChildren(
      ...(candidats.length
        ? candidats.map((id) => {
            const membre = connus.get(id) ?? {
              id,
              pseudo: t('channels.unknownUser'),
            };
            return creerBouton(
              `${t('servers.makeOwner')} · ${ChatUiShared.nomAffiche(membre)}`,
              'secondary-button full-width',
              () =>
                agir(
                  () =>
                    window.electronAPI.expulserMembre({
                      serveurId: serveur.id,
                      utilisateurId: proprietaireId,
                      nouveauProprietaire: id,
                    }),
                  t('servers.kicked')
                )
            );
          })
        : [
            creerEl('p', {
              classe: 'empty-state',
              texte: t('servers.noOtherMember'),
            }),
          ])
    );
    ouvrirDialogue(t('servers.transferTitle', { name: nomProprietaire }), [
      creerEl('p', { texte: t('servers.transferHint') }),
      choix,
    ]);
  }

  ouvrirDialogue(t('servers.membersOf', { name: serveur.nom }), [liste, plus]);
  void chargerPage(0);
});

// --- Paramètres du salon (modérateur du serveur minimum) ---------------------
el.roomSettings?.addEventListener('click', () => {
  const salon = salonActif();
  if (!salon) return;

  const champNom = creerEl('input', {
    attrs: { maxlength: '80', value: salon.nom },
  });
  const reserve = creerCaseACocher(
    t('channels.moderatorsOnlyLabel'),
    salon.acces === 'moderateurs'
  );
  const lectureSeule = creerCaseACocher(
    t('channels.writeModeratorsLabel'),
    salon.ecriture === 'moderateurs'
  );

  ouvrirDialogue(t('roomSettings.title'), [
    creerEl('label', {
      enfants: [
        document.createTextNode(t('channels.channelNameLabel')),
        champNom,
      ],
    }),
    reserve.ligne,
    lectureSeule.ligne,
    creerBouton(t('roomSettings.save'), 'primary-button full-width', () => {
      const nom = champNom.value.trim();
      if (!nom) return;
      return agir(
        () =>
          window.electronAPI.modifierSalon({
            salonId: salon.id,
            nom,
            acces: reserve.champ.checked ? 'moderateurs' : 'tous',
            ecriture: lectureSeule.champ.checked ? 'moderateurs' : 'tous',
          }),
        t('roomSettings.updated')
      );
    }),
    creerBoutonConfirme(
      t('roomSettings.delete'),
      t('roomSettings.deleteConfirm'),
      () =>
        agir(async () => {
          await window.electronAPI.supprimerSalon(salon.id);
          if (salonActifId === salon.id) salonActifId = null;
        }, t('roomSettings.deleted'))
    ),
  ]);
});

// --- Menu du serveur (clic sur son nom, en haut de la colonne) ---------------
el.menuServeur?.addEventListener('click', () => {
  const serveur = etat.serveurActif;
  if (!serveur) return;
  const role = roleActuel();
  const contenu = [];

  if (ChatUiShared.peutGererServeur(role)) {
    const champNom = creerEl('input', {
      attrs: { maxlength: '80', value: serveur.nom },
    });
    const public_ = creerCaseACocher(t('servers.publicLabel'), serveur.public);
    // Chatvardage reste public (règle de Room-Service).
    public_.champ.disabled = serveur.parDefaut;
    contenu.push(
      creerEl('label', {
        enfants: [document.createTextNode(t('servers.nameLabel')), champNom],
      }),
      public_.ligne,
      creerBouton(t('roomSettings.save'), 'primary-button full-width', () => {
        const nom = champNom.value.trim();
        if (!nom) return;
        return agir(
          () =>
            window.electronAPI.modifierServeur({
              serveurId: serveur.id,
              nom,
              ...(serveur.parDefaut ? {} : { public: public_.champ.checked }),
            }),
          t('servers.updated')
        );
      })
    );
  }

  if (!serveur.parDefaut && ChatUiShared.peutModererServeur(role)) {
    contenu.push(
      creerBouton(
        t('servers.invitePeople'),
        'secondary-button full-width',
        () => {
          el.dialogue.close();
          el.inviter.click();
        }
      )
    );
  }

  if (!serveur.parDefaut && role !== null && role !== 'proprietaire') {
    contenu.push(
      creerBoutonConfirme(t('servers.leave'), t('servers.leaveConfirm'), () =>
        agir(async () => {
          await window.electronAPI.quitterServeur(serveur.id);
          serveurActifId = null;
          salonActifId = null;
        }, t('servers.left'))
      )
    );
  }

  if (!serveur.parDefaut && ChatUiShared.peutGererServeur(role)) {
    contenu.push(
      creerBoutonConfirme(t('servers.delete'), t('servers.deleteConfirm'), () =>
        agir(async () => {
          await window.electronAPI.supprimerServeur(serveur.id);
          serveurActifId = null;
          salonActifId = null;
        }, t('servers.deleted'))
      )
    );
  }

  if (!contenu.length) {
    contenu.push(
      creerEl('p', {
        classe: 'empty-state',
        texte: serveur.parDefaut
          ? t('servers.defaultServerInfo')
          : t('servers.noActions'),
      })
    );
  }
  ouvrirDialogue(serveur.nom, contenu);
});
