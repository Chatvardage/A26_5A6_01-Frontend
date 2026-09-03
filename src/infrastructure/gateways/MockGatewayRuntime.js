'use strict';

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
        membreIds: ['u1', 'u2', 'u3'],
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
        membreIds: ['u1', 'u3'],
        membresInvites: [],
        messages: [],
      },
    ];
    this.conversationsPrivees = [
      { id: 'u1-u2', participantIds: ['u1', 'u2'] },
      { id: 'u1-u3', participantIds: ['u1', 'u3'] },
      { id: 'u1-u4', participantIds: ['u1', 'u4'] },
      { id: 'u1-u5', participantIds: ['u1', 'u5'] },
      { id: 'u2-u3', participantIds: ['u2', 'u3'] },
      { id: 'u2-u5', participantIds: ['u2', 'u5'] },
      { id: 'u2-u6', participantIds: ['u2', 'u6'] },
    ];

    this.messagesPrives = [
      {
        id: 'msg-dm-1',
        conversationId: 'u1-u2',
        auteurId: 'u1',
        contenu: 'Salut, on se voit ce soir ?',
        envoi: now - 10 * 60000,
      },
      {
        id: 'msg-dm-2',
        conversationId: 'u1-u2',
        auteurId: 'u2',
        contenu: 'Oui, vers 20h, ça marche.',
        envoi: now - 9 * 60000,
      },
      {
        id: 'msg-dm-3',
        conversationId: 'u1-u3',
        auteurId: 'u3',
        contenu: 'Tu as vu le dernier sprint ?',
        envoi: now - 8 * 60000,
      },
      {
        id: 'msg-dm-4',
        conversationId: 'u1-u3',
        auteurId: 'u1',
        contenu: 'Oui, je le valide demain.',
        envoi: now - 7 * 60000,
      },
      {
        id: 'msg-dm-5',
        conversationId: 'u1-u4',
        auteurId: 'u4',
        contenu: 'J’ai envoyé le document de synthèse.',
        envoi: now - 6 * 60000,
      },
      {
        id: 'msg-dm-6',
        conversationId: 'u1-u4',
        auteurId: 'u1',
        contenu: 'Parfait, je le relirai tout à l’heure.',
        envoi: now - 5 * 60000,
      },
      {
        id: 'msg-dm-7',
        conversationId: 'u2-u5',
        auteurId: 'u2',
        contenu: 'Le rapport est prêt pour relecture.',
        envoi: now - 4 * 60000,
      },
      {
        id: 'msg-dm-8',
        conversationId: 'u2-u5',
        auteurId: 'u5',
        contenu: 'Merci, je le regarde ce midi.',
        envoi: now - 3 * 60000,
      },
      {
        id: 'msg-dm-9',
        conversationId: 'u1-u2',
        auteurId: 'u1',
        contenu: 'Tu as pu réserver la table ?',
        envoi: now - 2 * 60000,
      },
      {
        id: 'msg-dm-10',
        conversationId: 'u1-u2',
        auteurId: 'u2',
        contenu: 'C’est tout bon, pour 20h.',
        envoi: now - 1 * 60000,
      },
      {
        id: 'msg-dm-11',
        conversationId: 'u1-u5',
        auteurId: 'u5',
        contenu: 'On fait le point en début d’après-midi ?',
        envoi: now - 11 * 60000,
      },
      {
        id: 'msg-dm-12',
        conversationId: 'u1-u5',
        auteurId: 'u1',
        contenu: 'Oui, envoie-moi tes disponibilités.',
        envoi: now - 10.5 * 60000,
      },
      {
        id: 'msg-dm-13',
        conversationId: 'u2-u3',
        auteurId: 'u3',
        contenu: 'Je te partage la maquette finale.',
        envoi: now - 9.5 * 60000,
      },
      {
        id: 'msg-dm-14',
        conversationId: 'u2-u3',
        auteurId: 'u2',
        contenu: 'Top, je vais la présenter à l’équipe.',
        envoi: now - 9 * 60000,
      },
      {
        id: 'msg-dm-15',
        conversationId: 'u2-u6',
        auteurId: 'u6',
        contenu: 'Tu peux valider la demande de merge ?',
        envoi: now - 8.5 * 60000,
      },
      {
        id: 'msg-dm-16',
        conversationId: 'u2-u6',
        auteurId: 'u2',
        contenu: 'Oui, je la traite juste après le stand-up.',
        envoi: now - 8 * 60000,
      },
      {
        id: 'msg-dm-17',
        conversationId: 'u1-u3',
        auteurId: 'u1',
        contenu: 'Pense à mettre à jour les estimations avant la réunion.',
        envoi: now - 7.5 * 60000,
      },
      {
        id: 'msg-dm-18',
        conversationId: 'u1-u3',
        auteurId: 'u3',
        contenu: 'C’est noté, j’ajuste les cartes Jira.',
        envoi: now - 7 * 60000,
      },
      {
        id: 'msg-dm-19',
        conversationId: 'u1-u4',
        auteurId: 'u4',
        contenu: 'Est-ce que le retour client a été pris en compte ?',
        envoi: now - 6.5 * 60000,
      },
      {
        id: 'msg-dm-20',
        conversationId: 'u1-u4',
        auteurId: 'u1',
        contenu: 'Oui, tout est intégré dans la dernière version.',
        envoi: now - 6 * 60000,
      },
      {
        id: 'msg-dm-21',
        conversationId: 'u2-u6',
        auteurId: 'u6',
        contenu: 'Merge effectué, les tests CI passent tous au vert.',
        envoi: now - 5.5 * 60000,
      },
      {
        id: 'msg-dm-22',
        conversationId: 'u2-u6',
        auteurId: 'u2',
        contenu: 'Super, merci pour ta réactivité !',
        envoi: now - 5 * 60000,
      },
    ];
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

  obtenirConversationsPrivees(utilisateurId) {
    const utilisateurActuelId = utilisateurId ?? 'u1';
    this.verifierUtilisateur(utilisateurActuelId);
    return this.conversationsPrivees
      .filter((conversation) =>
        conversation.participantIds.includes(utilisateurActuelId)
      )
      .map((conversation) => {
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
      });
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

  envoyerMessagePrive(conversationId, contenu, utilisateurId) {
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
    const message = {
      id: `mp-${Date.now()}`,
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
