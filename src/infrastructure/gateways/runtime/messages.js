'use strict';

// runtime/messages.js — Messages de salon et messages privés (Message-Service).
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const {
  TAILLE_PAGE_MESSAGES,
  TAILLE_PAGE_RECHERCHE,
  creerDmId,
} = require('./constantes');

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
    // Historique illisible (panne passagère) : la conversation reste
    // listée avec son dernier message connu, son historique sera chargé
    // à l'ouverture (finHistorique false) au lieu de disparaître.
    const { messages, finHistorique } =
      await this.obtenirMessagesPriveesAvantParUtilisateur(
        autreUtilisateurId
      ).catch(() => ({ messages: [], finHistorique: false }));
    await this.resoudrePseudos([autreUtilisateurId]);
    const autre = this.utilisateursConnus.get(autreUtilisateurId);
    const dernier =
      messages[messages.length - 1] ??
      (dernierMessageConnu ? this.mapperMessageDm(dernierMessageConnu) : null);
    return {
      id: creerDmId(this.utilisateurConnecte.id, autreUtilisateurId),
      participantIds: [this.utilisateurConnecte.id, autreUtilisateurId],
      otherUser: {
        id: autreUtilisateurId,
        pseudo: autre?.pseudo ?? autreUtilisateurId,
        // Pseudo pas encore résolu (panne passagère) : la page redemandera.
        pseudoInconnu: !autre,
        present: this.presences[autreUtilisateurId] === 'en-ligne',
        alias: this.profilsPublics.get(autreUtilisateurId)?.alias ?? null,
        avatar: this.profilsPublics.get(autreUtilisateurId)?.avatar ?? null,
      },
      messages,
      finHistorique,
      lastMessage: dernier,
    };
  },

  /**
   * Liste les conversations privées de l'utilisateur courant. Combine
   * `GET /api/messages/conversations` (source principale, voir
   * Message-Service) et les partenaires connus localement cette session
   * (`partenairesDmConnus` : conversation tout juste démarrée, avant tout
   * message). Lève une erreur si la liste du serveur est illisible.
   */
  async obtenirConversationsPrivees() {
    // Échec remonté à la page (qui garde sa liste et réessaie) : une liste
    // vide ou partielle affichée sans rien dire faisait croire à l'absence
    // de conversations.
    const resume = await this.appelHttp('/api/messages/conversations');
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
    return conversations.sort(
      (a, b) => (b.lastMessage?.envoi ?? 0) - (a.lastMessage?.envoi ?? 0)
    );
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

  // --- Messages non lus et recherche (Message-Service) -------------------------
  // Message-Service identifie une conversation par `dm:<interlocuteur>` ou
  // `room:<salon>` ; l'app, par l'id de DM (creerDmId) ou l'id du salon.

  /** `{ type, conversationId }` de l'app pour un identifiant de Message-Service
   * (null s'il est d'une forme inconnue). */
  versConversationLocale(idServeur) {
    const [genre, cible] = String(idServeur).split(':');
    if (!cible) return null;
    if (genre === 'room') return { type: 'salon', conversationId: cible };
    if (genre === 'dm') {
      return {
        type: 'prive',
        conversationId: creerDmId(this.utilisateurConnecte.id, cible),
      };
    }
    return null;
  },

  /**
   * Messages non lus par conversation (`GET /api/messages/unread`), état
   * tenu par le serveur : identique sur tous les appareils et après un
   * redémarrage. `{ salons: { [salonId]: n }, prives: { [dmId]: n } }`,
   * sans les conversations lues.
   */
  async obtenirNonLus() {
    const nonLus = { salons: {}, prives: {} };
    if (!this.utilisateurConnecte) return nonLus;
    const { counts } = await this.appelHttp('/api/messages/unread');
    for (const [idServeur, nombre] of Object.entries(counts ?? {})) {
      const locale = this.versConversationLocale(idServeur);
      if (!locale || !(nombre > 0)) continue;
      const cible = locale.type === 'salon' ? nonLus.salons : nonLus.prives;
      cible[locale.conversationId] = nombre;
    }
    return nonLus;
  },

  /** Marque une conversation comme lue jusqu'à son dernier message. */
  async marquerConversationLue({ type, conversationId }) {
    const chemin =
      type === 'salon'
        ? `/api/messages/rooms/${encodeURIComponent(conversationId)}/read`
        : `/api/messages/conversations/${encodeURIComponent(this.autreParticipantDm(conversationId))}/read`;
    const etat = await this.appelHttp(chemin, { methode: 'PUT', corps: {} });
    return { nonLus: etat?.unreadCount ?? 0 };
  },

  /**
   * Recherche dans les conversations accessibles (`GET /api/messages/search`).
   * Chaque résultat porte de quoi l'afficher et l'ouvrir : le salon et son
   * serveur, ou l'interlocuteur. `curseurSuivant` : page suivante, ou null.
   */
  async rechercherMessages({ texte, curseur }) {
    const params = new URLSearchParams({
      q: texte,
      limit: String(TAILLE_PAGE_RECHERCHE),
    });
    if (curseur) params.set('cursor', curseur);
    const page = await this.appelHttp(
      `/api/messages/search?${params.toString()}`
    );
    const moi = this.utilisateurConnecte?.id;
    const bruts = page?.results ?? [];
    // Alias s'il y en a un, sinon pseudo (comme partout dans l'app) ; ses
    // propres messages : son pseudo.
    const nom = (id) =>
      this.profilsPublics.get(id)?.alias ??
      this.utilisateursConnus.get(id)?.pseudo ??
      (id === moi ? this.utilisateurConnecte.pseudo : null);
    await this.resoudrePseudos(
      bruts
        .flatMap(({ message }) =>
          message.roomId
            ? [message.authorId]
            : [message.senderId, message.recipientId]
        )
        .filter((id) => id && id !== moi)
    );
    const resultats = bruts.map(({ kind, message }) => {
      if (kind === 'room') {
        const mappe = this.mapperMessageSalon(message);
        this.indexMessages.set(mappe.id, {
          type: 'salon',
          roomId: message.roomId,
        });
        const serveurId = this.salonVersServeur.get(message.roomId) ?? null;
        const serveur = serveurId ? this.serveurs.get(serveurId) : null;
        return {
          type: 'salon',
          conversationId: message.roomId,
          salonNom:
            serveur?.salons.find((salon) => salon.id === message.roomId)?.nom ??
            null,
          serveurId,
          serveurNom: serveur?.nom ?? null,
          auteurNom: nom(mappe.auteurId),
          message: mappe,
        };
      }
      const mappe = this.mapperMessageDm(message);
      this.indexMessages.set(mappe.id, { type: 'dm' });
      const autreId =
        message.senderId === moi ? message.recipientId : message.senderId;
      return {
        type: 'prive',
        conversationId: mappe.conversationId,
        interlocuteurId: autreId,
        interlocuteurNom: nom(autreId),
        auteurNom: nom(mappe.auteurId),
        message: mappe,
      };
    });
    return { resultats, curseurSuivant: page?.nextCursor ?? null };
  },
};
