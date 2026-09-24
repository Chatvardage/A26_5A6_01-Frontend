// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Canaux IPC qui délèguent directement au gateway
// (profil, utilisateurs, présence, serveurs, salons, messages).
const { chatGateway } = require('./gateway');
const { exposerCanal } = require('./securite');

// --- Profil (page "Modifier le profil") --------------------------------------
exposerCanal('profil:obtenir', () => chatGateway.profilObtenir());
exposerCanal('profil:modifier-pseudo', ({ pseudo }) =>
  chatGateway.profilModifierPseudo(pseudo)
);
exposerCanal('profil:modifier-compte', (donnees) =>
  chatGateway.profilModifierCompte(donnees)
);
exposerCanal('profil:supprimer-compte', ({ motDePasseActuel }) =>
  chatGateway.profilSupprimerCompte(motDePasseActuel)
);

// --- Recherche d'utilisateurs (nouveau message privé) -------------------------
exposerCanal('utilisateurs:suggestions-dm', () =>
  chatGateway.obtenirSuggestionsDm()
);
exposerCanal('utilisateurs:rechercher', ({ texte }) =>
  chatGateway.rechercherUtilisateurs(texte)
);

// --- Réseau / présence -----------------------------------------------------
exposerCanal('reseau:etat', () => chatGateway.obtenirEtatConnexion());
exposerCanal('reseau:reessayer', () => chatGateway.reconnecterMaintenant());
exposerCanal('presence:obtenir', () => chatGateway.obtenirPresences());
exposerCanal('presence:modifier', ({ statut }) =>
  chatGateway.modifierPresence({ statut })
);

// --- Serveurs et salons (Room-Service) -----------------------------------
// L'autorisation réelle est vérifiée par Room-Service à partir du JWT et du
// rôle de l'utilisateur DANS le serveur ; l'UI ne fait que masquer les
// actions indisponibles.
exposerCanal('salons:etat', ({ serveurId, salonId } = {}) =>
  chatGateway.obtenirEtat({ serveurId, salonId })
);
// Pagination "charger plus ancien" de l'historique d'un salon : salons:etat
// ci-dessus ne renvoie déjà plus que la page de messages la plus récente.
exposerCanal('salons:messages-avant', (donnees) =>
  chatGateway.obtenirMessagesSalonAvant(donnees)
);
exposerCanal('utilisateurs:lister', () => chatGateway.obtenirUtilisateurs());
exposerCanal('serveurs:lister', () => chatGateway.obtenirServeurs());
exposerCanal('serveurs:creer', (donnees) => chatGateway.creerServeur(donnees));
exposerCanal('serveurs:modifier', (donnees) =>
  chatGateway.modifierServeur(donnees)
);
exposerCanal('serveurs:supprimer', ({ serveurId }) =>
  chatGateway.supprimerServeur(serveurId)
);
exposerCanal('serveurs:rejoindre', ({ serveurId }) =>
  chatGateway.rejoindreServeur(serveurId)
);
exposerCanal('serveurs:quitter', ({ serveurId }) =>
  chatGateway.quitterServeur(serveurId)
);
exposerCanal('serveurs:decouvrir', ({ texte }) =>
  chatGateway.decouvrirServeurs(texte)
);
exposerCanal('serveurs:expulser', (donnees) =>
  chatGateway.expulserMembre(donnees)
);
exposerCanal('serveurs:changer-role', (donnees) =>
  chatGateway.changerRoleMembre(donnees)
);
exposerCanal('serveurs:inviter', (donnees) => chatGateway.inviter(donnees));
// Membres par pages (voir obtenirMembresServeur) et « qui est déjà membre »
// pour la fenêtre Inviter.
exposerCanal('serveurs:membres', (donnees) =>
  chatGateway.obtenirMembresServeur(donnees)
);
exposerCanal('serveurs:membres-parmi', (donnees) =>
  chatGateway.membresParmi(donnees)
);
exposerCanal('serveurs:accepter-invitation', (donnees) =>
  chatGateway.accepterInvitation(donnees)
);
exposerCanal('serveurs:refuser-invitation', (donnees) =>
  chatGateway.refuserInvitation(donnees)
);
exposerCanal('salons:creer', (donnees) => chatGateway.creerSalon(donnees));
exposerCanal('salons:modifier', (donnees) =>
  chatGateway.modifierSalon(donnees)
);
exposerCanal('salons:supprimer', ({ salonId }) =>
  chatGateway.supprimerSalon(salonId)
);
exposerCanal('salons:envoyer-message', (donnees) =>
  chatGateway.envoyerMessage(donnees)
);
exposerCanal('messages:modifier', (donnees) =>
  chatGateway.modifierMessage(donnees)
);
exposerCanal('messages:supprimer', (donnees) =>
  chatGateway.supprimerMessage(donnees)
);
// Pastilles « non lu » : dernier message de chaque conversation seulement.
exposerCanal('resumes-conversations-privees', () =>
  chatGateway.obtenirResumesConversationsPrivees()
);
exposerCanal('obtenir-conversations-privees', () =>
  chatGateway.obtenirConversationsPrivees()
);
// Pagination "charger plus ancien" de l'historique d'une conversation
// privée : obtenir-conversations-privees ci-dessus ne renvoie déjà plus que
// la page de messages la plus récente (voir obtenirConversationsPrivees
// dans RealGatewayRuntime.js).
exposerCanal('obtenir-messages-prive-avant', (donnees) =>
  chatGateway.obtenirMessagesPriveesAvant(donnees)
);

exposerCanal('envoyer-message-prive', (donnees) =>
  chatGateway.envoyerMessagePrive(donnees)
);
exposerCanal('demarrer-conversation-privee', (donnees) =>
  chatGateway.demarrerConversationPrivee(donnees)
);

exposerCanal('modifier-etat-saisie', (donnees) =>
  chatGateway.modifierEtatSaisie(donnees)
);

exposerCanal('obtenir-etats-saisie', (donnees) =>
  chatGateway.obtenirEtatsSaisie(donnees)
);
