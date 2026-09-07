'use strict';

/**
 * Crée un identifiant unique pour une conversation privée entre deux utilisateurs.
 * Doit rester identique à `creerDmId` de src/domain/entities/ConversationPrivee.ts :
 * les deux identifiants sont triés puis joints avec ':'. Ce fichier ne peut pas
 * importer directement le module TypeScript (Electron l'exécute sans étape de
 * compilation), d'où cette copie locale — toute modification du schéma d'ID doit
 * être répercutée dans les deux fichiers.
 *
 * @param utilisateurAId ID du premier utilisateur
 * @param utilisateurBId ID du deuxième utilisateur
 *
 * @returns Un identifiant unique pour la conversation privée entre les deux utilisateurs
 */
function creerDmId(utilisateurAId, utilisateurBId) {
  return [utilisateurAId, utilisateurBId].sort().join(':');
}

/**
 * Taille par défaut d'une page d'historique de messages (salon ou DM), voir
 * `paginerMessages` ci-dessous. Utilisée à la fois pour la page "récente"
 * initiale (obtenirEtat / obtenirConversationsPrivees) et pour chaque page
 * "plus ancienne" demandée ensuite (obtenirMessagesSalonAvant /
 * obtenirMessagesPriveesAvant), sauf si l'appelant précise sa propre taille.
 */
const TAILLE_PAGE_MESSAGES = 15;

/**
 * Historique de démonstration pour #général (salon public 's1') :
 * volontairement long (largement plus que TAILLE_PAGE_MESSAGES) pour pouvoir
 * tester "charger les messages plus anciens" / "fin de l'historique" dès le
 * lancement de l'app, sans avoir à envoyer des dizaines de messages à la
 * main. Chaque entrée est `[auteurId, contenu]` ; les dates sont générées
 * dans le constructeur (une minute d'écart entre chaque message, en
 * remontant depuis `now`), voir plus bas.
 */
const HISTORIQUE_DEMO_GENERAL = [
  ['u1', 'Bienvenue dans ChatVardage !'],
  ['u1', "Ce salon sert à jaser de tout et de rien, sentez-vous à l'aise."],
  ['u2', 'Salut tout le monde 👋'],
  ['u3', 'Hey ! Contente de rejoindre le salon.'],
  ['u4', 'Allo ! Ça va bien vous autres ?'],
  ['u2', 'Ça va super, merci ! Et toi Logan ?'],
  ['u4', "Pas pire, un peu occupé cette semaine avec l'école."],
  ['u5', 'Salut la gang !'],
  ['u6', 'Yo 👋'],
  ['u1', "Est-ce que tout le monde a réussi à installer l'appli ?"],
  ['u3', 'Oui, ça fonctionne bien de mon côté.'],
  ['u5', 'Pareil, aucun problème.'],
  ['u6', "Moi j'ai eu un petit bug au lancement mais ça s'est réglé."],
  ['u1', 'Bon à savoir, merci Fiona.'],
  ['u2', "Quelqu'un a des nouvelles du prochain sprint ?"],
  ['u4', "On dirait que ça avance bien, j'ai vu passer plusieurs PR."],
  ['u3', "Oui, j'ai vu ça aussi. Ça sent bon pour la démo."],
  ['u1', 'On devrait faire un point rapide demain matin.'],
  ['u5', 'Ça marche pour moi.'],
  ['u6', 'Moi aussi, ça me va.'],
  ['u2', 'Parfait, je vais envoyer une invitation.'],
  ['u4', 'Merci Ariane !'],
  ['u3', "Sinon, quelqu'un a testé les nouvelles notifications ?"],
  ['u1', "Oui, ça fonctionne bien, même le badge sur l'icône."],
  ['u5', "Cool, j'irai jeter un oeil."],
  ['u6', 'Est-ce que le mode sombre est prévu un jour ?'],
  ['u2', 'Bonne idée, je vais noter ça dans le backlog.'],
  ['u4', 'En attendant, le thème actuel est déjà pas mal joli.'],
  ['u3', "Je suis d'accord, les couleurs sont agréables."],
  ['u1', 'Merci, on a mis du temps à peaufiner ça.'],
  ['u5', "Est-ce que quelqu'un peut relire ma dernière PR ?"],
  ['u6', 'Je peux regarder ça après le dîner.'],
  ['u5', 'Merci beaucoup Fiona !'],
  ['u2', "N'oubliez pas la réunion d'équipe à 14h."],
  ['u4', 'Merci du rappel.'],
  ['u3', "J'y serai."],
  ['u1', 'Bonne journée à tous !'],
  ['u6', 'Bonne journée !'],
  ['u5', 'À plus tard 👋'],
  ['u2', 'On se reparle bientôt.'],
  ['u4', "C'est noté, à tantôt."],
  ['u1', 'Petit rappel : le build de démonstration est prévu vendredi.'],
  ['u3', "Merci, je vais m'assurer que tout est prêt de mon côté."],
];

/**
 * Mock d'exécution utilisé par Electron jusqu'à l'arrivée du backend réel.
 * L'UI n'accède jamais à cet objet directement : main.js l'expose par des
 * canaux IPC précis via preload.js.
 */
class MockGatewayRuntime {
  constructor() {
    const now = Date.now();
    // Dates croissantes, une minute d'écart, la dernière entrée de
    // HISTORIQUE_DEMO_GENERAL se retrouvant la plus proche de `now` — voir
    // sa déclaration plus haut pour le pourquoi de cet historique volumineux.
    const messagesGeneral = HISTORIQUE_DEMO_GENERAL.map(
      ([auteurId, contenu], index) => ({
        auteurId,
        contenu,
        date: now - (HISTORIQUE_DEMO_GENERAL.length - index) * 60000,
      })
    );
    this.utilisateurs = [
      { id: 'u1', pseudo: 'sam' },
      { id: 'u2', pseudo: 'ariane' },
      { id: 'u3', pseudo: 'eva' },
      { id: 'u4', pseudo: 'logan' },
      { id: 'u5', pseudo: 'lili-rose' },
      { id: 'u6', pseudo: 'fiona' },
    ];

    this.etatsSaisie = [];

    this.presences = {
      u1: 'en-ligne',
      u2: 'hors-ligne',
      u3: 'en-ligne',
      u4: 'hors-ligne',
      u5: 'en-ligne',
      u6: 'hors-ligne',
    };
    this.salons = [
      {
        id: 's1',
        nom: 'général',
        visibilite: 'public',
        hoteId: 'u1',
        // Salon public : tous les utilisateurs en sont membres d'office.
        membreIds: this.utilisateurs.map((item) => item.id),
        membresInvites: [],
        messages: messagesGeneral,
      },
      {
        id: 's2',
        nom: 'équipe privée',
        visibilite: 'prive',
        hoteId: 'u1',
        membreIds: ['u1', 'u2', 'u3'],
        membresInvites: [],
        messages: [],
      },
    ];

    // Compteur pour générer des ids de messages de salon uniques (voir
    // envoyerMessage), même principe que prochainMessagePriveIndex plus bas
    // pour les DM. Les messages de salon n'avaient auparavant pas d'id du
    // tout (rien n'en dépendait) : la pagination par curseur (voir
    // paginerMessages) a besoin d'un id stable par message pour désigner
    // "le message avant lequel charger la page suivante" (avantId), d'où
    // cette assignation rétroactive aux messages déjà seedés ci-dessus.
    this.prochainMessageSalonIndex = 0;
    this.salons.forEach((salon) => {
      salon.messages.forEach((message) => {
        message.id = `msg-s-${this.prochainMessageSalonIndex++}`;
      });
    });

    // Mêmes paires DM que celles seedées dans MockGateway.ts, pour que les
    // deux mocks exposent des données cohérentes.
    this.conversationsPrivees = [
      { id: creerDmId('u1', 'u2'), participantIds: ['u1', 'u2'] },
      { id: creerDmId('u1', 'u3'), participantIds: ['u1', 'u3'] },
      { id: creerDmId('u1', 'u4'), participantIds: ['u1', 'u4'] },
      { id: creerDmId('u2', 'u5'), participantIds: ['u2', 'u5'] },
      { id: creerDmId('u3', 'u6'), participantIds: ['u3', 'u6'] },
    ];

    this.messagesPrives = [
      {
        id: 'msg-dm-1',
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u1',
        contenu: 'Salut, on se voit ce soir ?',
        envoi: now - 16 * 60000,
      },
      {
        id: 'msg-dm-2',
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u2',
        contenu: 'Oui, vers 20h, ça marche.',
        envoi: now - 15 * 60000,
      },
      {
        id: 'msg-dm-3',
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u3',
        contenu: 'Tu as vu le dernier sprint ?',
        envoi: now - 14 * 60000,
      },
      {
        id: 'msg-dm-4',
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u1',
        contenu: 'Oui, je le valide demain.',
        envoi: now - 13 * 60000,
      },
      {
        id: 'msg-dm-5',
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u4',
        contenu: 'J’ai envoyé le document de synthèse.',
        envoi: now - 12 * 60000,
      },
      {
        id: 'msg-dm-6',
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u1',
        contenu: 'Parfait, je le relirai tout à l’heure.',
        envoi: now - 11 * 60000,
      },
      {
        id: 'msg-dm-7',
        conversationId: creerDmId('u2', 'u5'),
        auteurId: 'u2',
        contenu: 'Le rapport est prêt pour relecture.',
        envoi: now - 10 * 60000,
      },
      {
        id: 'msg-dm-8',
        conversationId: creerDmId('u2', 'u5'),
        auteurId: 'u5',
        contenu: 'Merci, je le regarde ce midi.',
        envoi: now - 9 * 60000,
      },
      {
        id: 'msg-dm-9',
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u1',
        contenu: 'Tu as pu réserver la table ?',
        envoi: now - 8 * 60000,
      },
      {
        id: 'msg-dm-10',
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u2',
        contenu: 'C’est tout bon, pour 20h.',
        envoi: now - 7 * 60000,
      },
      {
        id: 'msg-dm-11',
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u1',
        contenu: 'Pense à mettre à jour les estimations avant la réunion.',
        envoi: now - 6 * 60000,
      },
      {
        id: 'msg-dm-12',
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u3',
        contenu: 'C’est noté, j’ajuste les cartes Jira.',
        envoi: now - 5 * 60000,
      },
      {
        id: 'msg-dm-13',
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u4',
        contenu: 'Est-ce que le retour client a été pris en compte ?',
        envoi: now - 4 * 60000,
      },
      {
        id: 'msg-dm-14',
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u1',
        contenu: 'Oui, tout est intégré dans la dernière version.',
        envoi: now - 3 * 60000,
      },
      {
        id: 'msg-dm-15',
        conversationId: creerDmId('u3', 'u6'),
        auteurId: 'u6',
        contenu: 'Tu as vu le dernier correctif ?',
        envoi: now - 2 * 60000,
      },
      {
        id: 'msg-dm-16',
        conversationId: creerDmId('u3', 'u6'),
        auteurId: 'u3',
        contenu: 'Oui, il a déjà été validé.',
        envoi: now - 60000,
      },
    ];

    // Compteur pour générer des ids de messages privés uniques (voir
    // envoyerMessagePrive) sans dépendre de l'horloge système.
    this.prochainMessagePriveIndex = this.messagesPrives.length;

    // Initialisé explicitement à `null` (plutôt que laissé non défini) :
    // obtenirUtilisateurConnecte() ci-dessous documente et contractuellement
    // renvoie `null` tant que personne ne s'est connecté via l'écran de
    // connexion, et le renderer attend `Promise<string | null>` — pas
    // `undefined`, que `connexion()` remplace de toute façon dès le premier
    // appel.
    this.utilisateurConnecteId = null;
  }

  /**
   * Pagine `messagesTries` (déjà triés du plus ancien au plus récent) avant
   * le message d'identifiant `avantId`, en retournant au plus `taille`
   * messages qui le précèdent immédiatement — pagination "charger plus
   * ancien". Même logique que `paginerAvant` du domaine
   * (src/domain/entities/Message.ts), dupliquée ici pour la même raison que
   * `creerDmId` ci-dessus (ce fichier est exécuté par Electron sans étape de
   * compilation, donc ne peut pas importer directement un module TS).
   *
   * Si `avantId` est absent, pagine à partir de la fin (page la plus
   * récente, utilisée pour le chargement initial). Si `avantId` ne
   * correspond à aucun message (ex. déjà retiré), retombe aussi sur la fin
   * plutôt que de planter.
   *
   * @param {Array<{id: string}>} messagesTries
   * @param {string|undefined} avantId
   * @param {number} taille
   * @returns {{ page: Array, finHistorique: boolean }} `finHistorique` est
   *   vrai quand cette page remonte jusqu'au tout premier message de la
   *   conversation (plus rien de plus ancien à charger).
   */
  paginerMessages(messagesTries, avantId, taille) {
    const indexFin = avantId
      ? messagesTries.findIndex((m) => m.id === avantId)
      : messagesTries.length;
    const finSure = indexFin === -1 ? messagesTries.length : indexFin;
    const tailleSure =
      Number.isFinite(taille) && taille > 0 ? taille : TAILLE_PAGE_MESSAGES;
    const debut = Math.max(0, finSure - tailleSure);
    return {
      page: messagesTries.slice(debut, finSure),
      finHistorique: debut === 0,
    };
  }

  verifierUtilisateur(utilisateurId) {
    if (!this.utilisateurs.some((item) => item.id === utilisateurId)) {
      throw new Error('ERR_UTILISATEUR_INVALIDE');
    }
  }

  obtenirUtilisateurs() {
    return this.utilisateurs.map((item) => ({ ...item }));
  }

  trouverSalon(salonId) {
    const salon = this.salons.find((item) => item.id === salonId);
    if (!salon) throw new Error('ERR_SALON_INTROUVABLE');
    return salon;
  }

  /**
   * Vérifie si un pseudo est disponible (aucun utilisateur enregistré ne le
   * porte déjà), comparaison insensible à la casse. Utilisé par l'écran de
   * connexion pour la validation "au fil de la frappe" (voir LoginPage.tsx).
   */
  pseudoDisponible(pseudo) {
    const normalise = String(pseudo ?? '')
      .trim()
      .toLowerCase();
    return !this.utilisateurs.some(
      (item) => item.pseudo.toLowerCase() === normalise
    );
  }

  /**
   * Établit la connexion pour un utilisateur et crée sa session locale.
   * Enregistre l'utilisateur s'il est nouveau (en revérifiant l'unicité du
   * pseudo, défense en profondeur au cas où l'UI aurait laissé passer un
   * pseudo déjà pris entre la vérification et la soumission), puis marque
   * cet utilisateur comme "connecté" pour le dashboard (voir
   * obtenirUtilisateurConnecte).
   *
   * @param {{id: string, pseudo: string}} utilisateur
   * @returns {{statut: string, reconnexions: number}}
   */
  connexion({ id, pseudo }) {
    const dejaEnregistre = this.utilisateurs.some((item) => item.id === id);
    if (!dejaEnregistre) {
      // Rejette un '|' AVANT de regarder si le pseudo est disponible : la
      // convention "CODE|param" (voir plus bas) est le seul moyen simple de
      // faire voyager un paramètre dans un message d'erreur à travers
      // l'IPC, mais elle casse si `pseudo` contient lui-même un '|' (le
      // premier '|' ferait alors office de séparateur côté présentation,
      // tronquant le pseudo affiché) — y compris quand ce pseudo n'est PAS
      // déjà pris, le cas qu'un bypass de `validationPseudo` (domaine)
      // emprunterait en premier. Cette couche ne doit pas dépendre
      // silencieusement d'une règle définie ailleurs (l'UI) : on revérifie
      // ici, en défense en profondeur, avant toute autre logique.
      if (String(pseudo).includes('|')) {
        throw new Error('ERR_UTILISATEUR_INVALIDE');
      }
      if (!this.pseudoDisponible(pseudo)) {
        // Code stable plutôt qu'un message figé en français : la traduction
        // se fait à la frontière présentation (voir main.tsx
        // nettoyerErreurIpc), pas ici dans la couche métier, qui ne doit pas
        // connaître la langue choisie par l'utilisateur.
        throw new Error(`ERR_PSEUDO_PRIS|${pseudo}`);
      }
      this.utilisateurs.push({ id, pseudo });
    }
    this.utilisateurConnecteId = id;
    return { statut: 'connecte', reconnexions: 0 };
  }

  /**
   * Retourne l'identifiant de l'utilisateur connecté via l'écran de
   * connexion, ou null si personne ne s'est encore connecté par ce biais
   * (ex. dashboard ouvert directement en développement, sans passer par la
   * page de connexion).
   */
  obtenirUtilisateurConnecte() {
    // Normalisation défensive vers `null` (voir l'initialisation dans le
    // constructeur) : garde le contrat vrai même si un futur changement
    // retire à nouveau cette initialisation par erreur.
    return this.utilisateurConnecteId ?? null;
  }

  // Construit le DTO exposé au renderer pour un salon donné : ses messages
  // sont limités à la page la plus récente (voir paginerMessages), pas
  // l'historique complet — l'historique plus ancien se charge ensuite à la
  // demande via obtenirMessagesSalonAvant. `finHistorique` indique si cette
  // page récente remonte déjà jusqu'au tout premier message du salon (rien
  // de plus ancien à proposer de charger).
  construireSalonDTO(salon) {
    const { messages, ...salonSansMessages } = salon;
    const messagesTries = [...messages].sort((a, b) => a.date - b.date);
    const { page, finHistorique } = this.paginerMessages(
      messagesTries,
      undefined,
      TAILLE_PAGE_MESSAGES
    );
    return {
      ...structuredClone(salonSansMessages),
      messages: structuredClone(page),
      finHistorique,
    };
  }

  obtenirEtat(utilisateurId) {
    this.verifierUtilisateur(utilisateurId);
    return {
      utilisateurs: this.utilisateurs.map((item) => ({ ...item })),
      salons: this.salons
        .filter(
          (salon) =>
            salon.visibilite === 'public' ||
            salon.membreIds.includes(utilisateurId)
        )
        .map((salon) => this.construireSalonDTO(salon)),
      invitations: this.salons
        .filter((salon) => salon.membresInvites.includes(utilisateurId))
        .map((salon) => ({
          id: salon.id,
          nom: salon.nom,
          hoteId: salon.hoteId,
        })),
    };
  }

  /**
   * Retourne une page plus ancienne de l'historique d'un salon (pagination
   * "charger plus ancien" — voir paginerMessages), une fois la page récente
   * initiale déjà affichée (voir construireSalonDTO/obtenirEtat).
   *
   * @param {{salonId: string, utilisateurId: string, avantId?: string, taille?: number}} param0
   * @returns {{ messages: Array, finHistorique: boolean }}
   */
  obtenirMessagesSalonAvant({ salonId, utilisateurId, avantId, taille }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    const estMembre =
      salon.visibilite === 'public' || salon.membreIds.includes(utilisateurId);
    if (!estMembre) {
      throw new Error('ERR_ACCES_REFUSE_SALON');
    }
    const messagesTries = [...salon.messages].sort((a, b) => a.date - b.date);
    const { page, finHistorique } = this.paginerMessages(
      messagesTries,
      avantId,
      taille
    );
    return { messages: structuredClone(page), finHistorique };
  }

  // Construit le DTO exposé au renderer pour une conversation privée donnée,
  // du point de vue de `utilisateurActuelId`. Partagé entre
  // obtenirConversationsPrivees (liste existante) et demarrerConversationPrivee
  // (nouvelle conversation ou conversation déjà existante) pour que les deux
  // renvoient toujours la même forme de données.
  construireConversationPriveeDTO(conversation, utilisateurActuelId) {
    const otherUserId = conversation.participantIds.find(
      (id) => id !== utilisateurActuelId
    );
    const otherUser = this.utilisateurs.find((u) => u.id === otherUserId);
    const messages = this.messagesPrives
      .filter((m) => m.conversationId === conversation.id)
      .sort((a, b) => a.envoi - b.envoi);
    const lastMessage = messages[messages.length - 1];
    // `messages` n'expose que la page la plus récente (voir paginerMessages),
    // pas l'historique complet de la conversation — l'historique plus ancien
    // se charge ensuite à la demande via obtenirMessagesPriveesAvant.
    // `lastMessage` reste calculé sur la liste complète triée ci-dessus (pas
    // sur la page), même si en pratique il en fait toujours partie (c'est le
    // tout dernier message).
    const { page: messagesRecents, finHistorique } = this.paginerMessages(
      messages,
      undefined,
      TAILLE_PAGE_MESSAGES
    );
    return {
      id: conversation.id,
      participantIds: [...conversation.participantIds],
      otherUser: {
        id: otherUser?.id ?? 'inconnu',
        pseudo: otherUser?.pseudo ?? 'Utilisateur',
        present: this.presences[otherUser?.id] === 'en-ligne',
      },
      messages: messagesRecents.map((m) => ({ ...m })),
      finHistorique,
      lastMessage: lastMessage ? { ...lastMessage } : null,
    };
  }

  /**
   * Retourne une page plus ancienne de l'historique d'une conversation
   * privée (pagination "charger plus ancien" — voir paginerMessages), une
   * fois la page récente initiale déjà affichée (voir
   * construireConversationPriveeDTO/obtenirConversationsPrivees).
   *
   * @param {{conversationId: string, utilisateurId: string, avantId?: string, taille?: number}} param0
   * @returns {{ messages: Array, finHistorique: boolean }}
   */
  obtenirMessagesPriveesAvant({
    conversationId,
    utilisateurId,
    avantId,
    taille,
  }) {
    const utilisateurActuelId = utilisateurId ?? 'u1';
    this.verifierUtilisateur(utilisateurActuelId);
    const conversation = this.conversationsPrivees.find(
      (item) => item.id === conversationId
    );
    if (!conversation) throw new Error('ERR_CONVERSATION_PRIVEE_INTROUVABLE');
    if (!conversation.participantIds.includes(utilisateurActuelId)) {
      throw new Error('ERR_ACCES_REFUSE_CONVERSATION');
    }
    const messages = this.messagesPrives
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.envoi - b.envoi);
    const { page, finHistorique } = this.paginerMessages(
      messages,
      avantId,
      taille
    );
    return { messages: page.map((m) => ({ ...m })), finHistorique };
  }

  obtenirConversationsPrivees(utilisateurId) {
    const utilisateurActuelId = utilisateurId ?? 'u1';
    this.verifierUtilisateur(utilisateurActuelId);
    return this.conversationsPrivees
      .filter((conversation) =>
        conversation.participantIds.includes(utilisateurActuelId)
      )
      .map((conversation) =>
        this.construireConversationPriveeDTO(conversation, utilisateurActuelId)
      );
  }

  // Démarre une nouvelle conversation privée avec un autre utilisateur, ou
  // retourne l'existante si les deux utilisateurs ont déjà un DM (même schéma
  // d'ID que creerDmId : idempotent, jamais de doublon).
  demarrerConversationPrivee({ utilisateurId, autreUtilisateurId }) {
    const utilisateurActuelId = utilisateurId ?? 'u1';
    this.verifierUtilisateur(utilisateurActuelId);
    this.verifierUtilisateur(autreUtilisateurId);
    if (utilisateurActuelId === autreUtilisateurId) {
      throw new Error('ERR_CONVERSATION_AVEC_SOI_MEME');
    }

    const conversationId = creerDmId(utilisateurActuelId, autreUtilisateurId);
    let conversation = this.conversationsPrivees.find(
      (item) => item.id === conversationId
    );
    if (!conversation) {
      conversation = {
        id: conversationId,
        participantIds: [utilisateurActuelId, autreUtilisateurId],
      };
      this.conversationsPrivees.push(conversation);
    }

    return this.construireConversationPriveeDTO(
      conversation,
      utilisateurActuelId
    );
  }

  creerSalon({ nom, prive, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const nomNettoye = typeof nom === 'string' ? nom.trim().slice(0, 40) : '';
    if (!nomNettoye) throw new Error('ERR_NOM_SALON_REQUIS');
    const visibilite = prive ? 'prive' : 'public';
    const salon = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nom: nomNettoye,
      visibilite,
      hoteId: utilisateurId,
      // Un salon public n'a pas d'invitations : tous les utilisateurs en
      // sont membres dès sa création.
      membreIds:
        visibilite === 'public'
          ? this.utilisateurs.map((item) => item.id)
          : [utilisateurId],
      membresInvites: [],
      messages: [],
    };
    this.salons.push(salon);
    return this.construireSalonDTO(salon);
  }

  inviter({ salonId, utilisateurId, hoteId }) {
    this.verifierUtilisateur(utilisateurId);
    this.verifierUtilisateur(hoteId);
    const salon = this.trouverSalon(salonId);
    if (salon.visibilite === 'public') {
      throw new Error('ERR_INVITATIONS_DESACTIVEES_PUBLIC');
    }
    if (salon.hoteId !== hoteId) throw new Error('ERR_SEUL_HOTE_PEUT_INVITER');
    if (salon.membreIds.includes(utilisateurId)) {
      return this.construireSalonDTO(salon);
    }
    if (!salon.membresInvites.includes(utilisateurId)) {
      salon.membresInvites.push(utilisateurId);
    }
    return this.construireSalonDTO(salon);
  }

  accepterInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('ERR_INVITATION_INTROUVABLE');
    }
    salon.membresInvites = salon.membresInvites.filter(
      (id) => id !== utilisateurId
    );
    if (!salon.membreIds.includes(utilisateurId)) {
      salon.membreIds.push(utilisateurId);
    }
    return this.construireSalonDTO(salon);
  }

  refuserInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('ERR_INVITATION_INTROUVABLE');
    }
    salon.membresInvites = salon.membresInvites.filter(
      (id) => id !== utilisateurId
    );
  }

  envoyerMessage({ salonId, utilisateurId, contenu }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    // Un salon public accepte implicitement tout le monde comme membre :
    // sans ça, un utilisateur créé après la seed initiale (alice/bob/
    // charlie) peut VOIR le salon (obtenirEtat ne vérifie que la
    // visibilité), mais ne peut jamais y écrire, puisque membreIds reste
    // figé à sa liste de création. On "rejoint" donc le salon au premier
    // message plutôt que d'exiger une étape d'adhésion séparée qui
    // n'existe pas encore dans cette UI.
    if (
      salon.visibilite === 'public' &&
      !salon.membreIds.includes(utilisateurId)
    ) {
      salon.membreIds.push(utilisateurId);
    }
    if (!salon.membreIds.includes(utilisateurId)) {
      throw new Error('ERR_ACCES_REFUSE_SALON');
    }
    const texte =
      typeof contenu === 'string' ? contenu.trim().slice(0, 2000) : '';
    if (!texte) throw new Error('ERR_MESSAGE_VIDE');
    const message = {
      id: `msg-s-${this.prochainMessageSalonIndex++}`,
      auteurId: utilisateurId,
      contenu: texte,
      date: Date.now(),
    };
    salon.messages.push(message);
    return structuredClone(message);
  }

  envoyerMessagePrive({ conversationId, contenu, utilisateurId }) {
    const utilisateurActuelId = utilisateurId ?? 'u1';
    this.verifierUtilisateur(utilisateurActuelId);
    const conversation = this.conversationsPrivees.find(
      (item) => item.id === conversationId
    );
    if (!conversation) throw new Error('ERR_CONVERSATION_PRIVEE_INTROUVABLE');
    if (!conversation.participantIds.includes(utilisateurActuelId)) {
      throw new Error('ERR_ACCES_REFUSE_CONVERSATION');
    }
    const texte =
      typeof contenu === 'string' ? contenu.trim().slice(0, 2000) : '';
    if (!texte) throw new Error('ERR_MESSAGE_VIDE');
    this.prochainMessagePriveIndex += 1;
    const message = {
      id: `mp-${this.prochainMessagePriveIndex}`,
      conversationId,
      auteurId: utilisateurActuelId,
      contenu: texte,
      envoi: Date.now(),
    };
    this.messagesPrives.push(message);
    return { ...message };
  }

  obtenirEtatsSaisie(param) {
    const id = typeof param === 'string' ? param : param?.conversationId;

    if (!id) return [];

    return this.etatsSaisie
      .filter((item) => item.conversationId === id)
      .map((item) => ({ ...item }));
  }

  modifierEtatSaisie({ conversationId, utilisateurId, est_saisie }) {
    this.verifierUtilisateur(utilisateurId);

    // 1. Chercher si la cible est un DM ou un Salon
    const dm = this.conversationsPrivees.find(
      (item) => item.id === conversationId
    );
    const salon = this.salons.find((item) => item.id === conversationId);

    if (!dm && !salon) {
      throw new Error('ERR_CONVERSATION_OU_SALON_INTROUVABLE');
    }

    // 2. Vérifier les autorisations selon le type de conversation
    if (dm && !dm.participantIds.includes(utilisateurId)) {
      throw new Error('ERR_ACCES_REFUSE_CONVERSATION');
    }

    if (salon) {
      // Pour les salons publics, tout le monde est membre d'office
      const estMembre =
        salon.visibilite === 'public' ||
        salon.membreIds.includes(utilisateurId);

      if (!estMembre) {
        throw new Error('ERR_ACCES_REFUSE_SALON');
      }
    }

    // 3. Mettre à jour l'état de saisie
    const etatSaisie = {
      conversationId,
      utilisateurId,
      est_saisie: Boolean(est_saisie),
    };

    const etatExistantIndex = this.etatsSaisie.findIndex(
      (item) =>
        item.conversationId === conversationId &&
        item.utilisateurId === utilisateurId
    );

    if (etatExistantIndex !== -1) {
      this.etatsSaisie[etatExistantIndex] = etatSaisie;
    } else {
      this.etatsSaisie.push(etatSaisie);
    }

    return { ...etatSaisie };
  }
}

module.exports = { MockGatewayRuntime };
