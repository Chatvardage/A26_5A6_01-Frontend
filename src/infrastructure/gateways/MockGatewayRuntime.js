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
 * Mock d'exécution utilisé par Electron jusqu'à l'arrivée du backend réel.
 * L'UI n'accède jamais à cet objet directement : main.js l'expose par des
 * canaux IPC précis via preload.js.
 */
class MockGatewayRuntime {
  constructor() {
    const now = Date.now();
    this.utilisateurs = [
      { id: 'u1', pseudo: 'sam' },
      { id: 'u2', pseudo: 'ariane' },
      { id: 'u3', pseudo: 'eva' },
      { id: 'u4', pseudo: 'logan' },
      { id: 'u5', pseudo: 'lili-rose' },
      { id: 'u6', pseudo: 'fiona' },
    ];
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
        messages: [
          {
            auteurId: 'u1',
            contenu: 'Bienvenue dans ChatVardage !',
            date: Date.now(),
          },
        ],
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
  }

  verifierUtilisateur(utilisateurId) {
    if (!this.utilisateurs.some((item) => item.id === utilisateurId)) {
      throw new Error('Utilisateur invalide');
    }
  }

  obtenirUtilisateurs() {
    return this.utilisateurs.map((item) => ({ ...item }));
  }

  trouverSalon(salonId) {
    const salon = this.salons.find((item) => item.id === salonId);
    if (!salon) throw new Error('Salon introuvable');
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
      if (!this.pseudoDisponible(pseudo)) {
        throw new Error(`Le pseudo "${pseudo}" est déjà utilisé.`);
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
    return this.utilisateurConnecteId;
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
        .map((salon) => structuredClone(salon)),
      invitations: this.salons
        .filter((salon) => salon.membresInvites.includes(utilisateurId))
        .map((salon) => ({
          id: salon.id,
          nom: salon.nom,
          hoteId: salon.hoteId,
        })),
    };
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
    return {
      id: conversation.id,
      participantIds: [...conversation.participantIds],
      otherUser: {
        id: otherUser?.id ?? 'inconnu',
        pseudo: otherUser?.pseudo ?? 'Utilisateur',
        present: this.presences[otherUser?.id] === 'en-ligne',
      },
      messages: messages.map((m) => ({ ...m })),
      lastMessage: lastMessage ? { ...lastMessage } : null,
    };
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
      throw new Error('Impossible de démarrer une conversation avec soi-même');
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
    if (!nomNettoye) throw new Error('Le nom du salon est obligatoire');
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
    return structuredClone(salon);
  }

  inviter({ salonId, utilisateurId, hoteId }) {
    this.verifierUtilisateur(utilisateurId);
    this.verifierUtilisateur(hoteId);
    const salon = this.trouverSalon(salonId);
    if (salon.visibilite === 'public') {
      throw new Error(
        'Les invitations sont désactivées pour les salons publics : tous les utilisateurs y sont déjà membres'
      );
    }
    if (salon.hoteId !== hoteId) throw new Error("Seul l'hôte peut inviter");
    if (salon.membreIds.includes(utilisateurId)) return structuredClone(salon);
    if (!salon.membresInvites.includes(utilisateurId)) {
      salon.membresInvites.push(utilisateurId);
    }
    return structuredClone(salon);
  }

  accepterInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('Invitation introuvable');
    }
    salon.membresInvites = salon.membresInvites.filter(
      (id) => id !== utilisateurId
    );
    if (!salon.membreIds.includes(utilisateurId)) {
      salon.membreIds.push(utilisateurId);
    }
    return structuredClone(salon);
  }

  refuserInvitation({ salonId, utilisateurId }) {
    this.verifierUtilisateur(utilisateurId);
    const salon = this.trouverSalon(salonId);
    if (!salon.membresInvites.includes(utilisateurId)) {
      throw new Error('Invitation introuvable');
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
      throw new Error('Accès refusé à ce salon');
    }
    const texte =
      typeof contenu === 'string' ? contenu.trim().slice(0, 2000) : '';
    if (!texte) throw new Error('Le message est vide');
    const message = {
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
    if (!conversation) throw new Error('Conversation privée introuvable');
    if (!conversation.participantIds.includes(utilisateurActuelId)) {
      throw new Error('Accès refusé à cette conversation');
    }
    const texte =
      typeof contenu === 'string' ? contenu.trim().slice(0, 2000) : '';
    if (!texte) throw new Error('Le message est vide');
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
}

module.exports = { MockGatewayRuntime };
