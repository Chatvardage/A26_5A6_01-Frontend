'use strict';

// runtime/messages.js — Messages de salon et messages privés (Message-Service).
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const { TAILLE_PAGE_MESSAGES, creerDmId } = require('./constantes');

module.exports = {
  // --- Messages de salon (HTTP, voir Message-Service) --------------------------

  async envoyerMessage({ salonId, contenu }) {
    this.verifierReseauConnecte();
    const brut = await this.appelHttp(
      `/api/messages/rooms/${encodeURIComponent(salonId)}`,
      { methode: 'POST', corps: { content: contenu } }
    );
    const message = this.mapperMessageSalon(brut);
    this.indexMessages.set(message.id, { type: 'salon', roomId: salonId });
    return message;
  },

  // --- Messages privés / DM (HTTP, voir Message-Service) ------------------------

  mapperMessageDm(brut) {
    const cree = new Date(brut.createdAt).getTime();
    const modifie = new Date(brut.updatedAt).getTime();
    return {
      id: brut.id,
      conversationId: creerDmId(brut.senderId, brut.recipientId),
      auteurId: brut.senderId,
      contenu: brut.content,
      envoi: cree,
      ...(modifie !== cree ? { modification: modifie } : {}),
    };
  },

  autreParticipantDm(conversationId) {
    const [a, b] = String(conversationId).split(':');
    const moi = this.utilisateurConnecte?.id;
    return a === moi ? b : a;
  },

  async obtenirMessagesPriveesAvantParUtilisateur(
    autreUtilisateurId,
    { avantId, taille } = {}
  ) {
    const limite = taille || TAILLE_PAGE_MESSAGES;
    const params = new URLSearchParams({ limit: String(limite) });
    if (avantId) params.set('cursor', avantId);
    const bruts = await this.appelHttp(
      `/api/messages/history/${encodeURIComponent(autreUtilisateurId)}?${params.toString()}`
    );
    const messages = bruts.map((m) => this.mapperMessageDm(m));
    messages.forEach((m) => this.indexMessages.set(m.id, { type: 'dm' }));
    return { messages, finHistorique: bruts.length < limite };
  },

  async obtenirMessagesPriveesAvant({ conversationId, avantId, taille }) {
    return this.obtenirMessagesPriveesAvantParUtilisateur(
      this.autreParticipantDm(conversationId),
      { avantId, taille }
    );
  },

  async construireConversationPrivee(autreUtilisateurId, dernierMessageConnu) {
    try {
      const { messages, finHistorique } =
        await this.obtenirMessagesPriveesAvantParUtilisateur(
          autreUtilisateurId
        );
      await this.resoudrePseudos([autreUtilisateurId]);
      const autre = this.utilisateursConnus.get(autreUtilisateurId);
      const dernier =
        messages[messages.length - 1] ??
        (dernierMessageConnu
          ? this.mapperMessageDm(dernierMessageConnu)
          : null);
      return {
        id: creerDmId(this.utilisateurConnecte.id, autreUtilisateurId),
        participantIds: [this.utilisateurConnecte.id, autreUtilisateurId],
        otherUser: {
          id: autreUtilisateurId,
          pseudo: autre?.pseudo ?? autreUtilisateurId,
          present: this.presences[autreUtilisateurId] === 'en-ligne',
          alias: this.profilsPublics.get(autreUtilisateurId)?.alias ?? null,
          avatar: this.profilsPublics.get(autreUtilisateurId)?.avatar ?? null,
        },
        messages,
        finHistorique,
        lastMessage: dernier,
      };
    } catch {
      return null;
    }
  },

  /**
   * Liste les conversations privées de l'utilisateur courant. Combine
   * `GET /api/messages/conversations` (source principale, voir
   * Message-Service) et les partenaires connus localement cette session
   * (`partenairesDmConnus`, repli si l'appel échoue ou pour une conversation
   * tout juste démarrée avant tout message).
   */
  async obtenirConversationsPrivees() {
    let resume = [];
    try {
      resume = await this.appelHttp('/api/messages/conversations');
    } catch {
      resume = [];
    }
    const partenaireIds = new Map();
    for (const item of resume) {
      partenaireIds.set(item.otherUserId, item.lastMessage);
      this.partenairesDmConnus.add(item.otherUserId);
    }
    for (const id of this.partenairesDmConnus) {
      if (!partenaireIds.has(id)) partenaireIds.set(id, null);
    }
    const conversations = await Promise.all(
      [...partenaireIds.entries()].map(([id, dernier]) =>
        this.construireConversationPrivee(id, dernier)
      )
    );
    return conversations
      .filter(Boolean)
      .sort(
        (a, b) => (b.lastMessage?.envoi ?? 0) - (a.lastMessage?.envoi ?? 0)
      );
  },

  /**
   * Version légère de obtenirConversationsPrivees, pour les pastilles « non
   * lu » : seulement l'id de chaque conversation et son dernier message, en
   * UN appel (`GET /api/messages/conversations`), sans recharger
   * l'historique de chaque interlocuteur.
   */
  async obtenirResumesConversationsPrivees() {
    if (!this.utilisateurConnecte) return [];
    const resume = await this.appelHttp('/api/messages/conversations');
    return (resume ?? []).map((item) => {
      this.partenairesDmConnus.add(item.otherUserId);
      const dernier = this.mapperMessageDm(item.lastMessage);
      this.indexMessages.set(dernier.id, { type: 'dm' });
      return {
        id: creerDmId(this.utilisateurConnecte.id, item.otherUserId),
        lastMessage: dernier,
      };
    });
  },

  async demarrerConversationPrivee({ autreUtilisateurId }) {
    this.partenairesDmConnus.add(autreUtilisateurId);
    return this.construireConversationPrivee(autreUtilisateurId);
  },

  async envoyerMessagePrive({ conversationId, contenu }) {
    this.verifierReseauConnecte();
    const autreUtilisateurId = this.autreParticipantDm(conversationId);
    const brut = await this.appelHttp('/api/messages', {
      methode: 'POST',
      corps: { recipientId: autreUtilisateurId, content: contenu },
    });
    const message = this.mapperMessageDm(brut);
    this.indexMessages.set(message.id, { type: 'dm' });
    this.partenairesDmConnus.add(autreUtilisateurId);
    return message;
  },

  // --- Modification/suppression de message (salon OU DM) -----------------------
  // Routées via l'index local (voir this.indexMessages) : le renderer appelle
  // un seul canal IPC générique pour les deux types (voir chat-ui-shared.js).

  async modifierMessage({ messageId, contenu }) {
    this.verifierReseauConnecte();
    const info = this.indexMessages.get(messageId);
    if (!info) throw new Error('ERR_MESSAGE_INTROUVABLE');
    if (info.type === 'salon') {
      const brut = await this.appelHttp(
        `/api/messages/rooms/${encodeURIComponent(info.roomId)}/${encodeURIComponent(messageId)}`,
        { methode: 'PATCH', corps: { content: contenu } }
      );
      return this.mapperMessageSalon(brut);
    }
    const brut = await this.appelHttp(
      `/api/messages/${encodeURIComponent(messageId)}`,
      { methode: 'PATCH', corps: { content: contenu } }
    );
    return this.mapperMessageDm(brut);
  },

  async supprimerMessage({ messageId }) {
    this.verifierReseauConnecte();
    const info = this.indexMessages.get(messageId);
    if (!info) throw new Error('ERR_MESSAGE_INTROUVABLE');
    if (info.type === 'salon') {
      await this.appelHttp(
        `/api/messages/rooms/${encodeURIComponent(info.roomId)}/${encodeURIComponent(messageId)}`,
        { methode: 'DELETE' }
      );
    } else {
      await this.appelHttp(`/api/messages/${encodeURIComponent(messageId)}`, {
        methode: 'DELETE',
      });
    }
    this.indexMessages.delete(messageId);
    return { messageId };
  },
};
