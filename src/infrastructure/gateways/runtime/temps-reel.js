'use strict';

// runtime/temps-reel.js — Socket.IO : connexion, événements temps réel, salons rejoints.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const {
  DELAI_ACK_REJOINDRE_SALON_MS,
  DELAI_RECONNEXION_INITIAL_MS,
  DELAI_REPLI_CONNEXION_PRETE_MS,
  creerDmId,
} = require('./constantes');

module.exports = {
  // --- WebSocket (Socket.IO) : événements temps réel ---------------------------

  connecterSocket() {
    this.fermerSocket();
    const socket = this.creerSocket(`${this.baseUrlSocket}/messages`, {
      auth: { token: this.jeton },
      reconnection: false, // backoff géré nous-même, voir planifierReconnexion
      transports: ['websocket'],
    });
    this.socket = socket;

    socket.on('connect', () => {
      if (this.socket !== socket) return;
      this.annulerReconnexionPlanifiee();
      this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
      this.definirEtatConnexion('connecte');
      this.demarrerBattementCoeur();
      // Profils modifiés pendant la coupure : rattrapés au prochain sondage
      // (voir avatarsARafraichir). Inutile à la toute première connexion,
      // les profils viennent d'être chargés avec leurs photos.
      if (this.dejaConnecte) this.avatarsARafraichir = true;
      this.dejaConnecte = true;
      // Présence et salons : PAS ici, mais sur 'connexion.prete' (plus bas),
      // avec un repli si cet événement n'arrive jamais.
      clearTimeout(this.minuteurRepliConnexionPrete);
      this.minuteurRepliConnexionPrete = setTimeout(() => {
        if (this.socket === socket && !this.socketPret) marquerPret();
      }, DELAI_REPLI_CONNEXION_PRETE_MS);
    });

    // Message-Service a fini d'authentifier ce socket. 'connect' arrive
    // AVANT (dès la poignée de main) : un 'presence.update' ou un
    // 'room-message.join' émis à ce moment-là est refusé par le serveur
    // (socket pas encore authentifié) — on restait alors « hors ligne »
    // pour les autres après une coupure réseau, et sans messages en direct.
    const marquerPret = () => {
      clearTimeout(this.minuteurRepliConnexionPrete);
      this.socketPret = true;
      // Redis Pub/Sub ne rejoue rien : les pages doivent relire leur etat
      // durable en REST une fois le socket authentifie et abonne aux DM.
      this.emettre('synchronisation-requise');
      // Les autres clients ont pu nous voir « hors ligne » pendant la coupure.
      this.annoncerPresence();
      // Session serveur neuve : abonnement à la présence à refaire.
      this.cleSuiviPresence = null;
      this.suivrePresence();
      // Rejoint à nouveau les rooms Socket.IO des salons déjà connus (une
      // reconnexion Socket.IO démarre une session serveur neuve).
      this.roomsSocketRejointes.clear();
      for (const salonId of this.salonsRejoints) {
        this.rejoindreSocketSalon(salonId);
      }
    };
    socket.on('connexion.prete', () => {
      if (this.socket !== socket) return;
      marquerPret();
    });

    socket.on('private-message.created', (m) =>
      this.traiterMessageDmEntrant(m)
    );
    socket.on('private-message.updated', (m) =>
      this.traiterMessageDmModifie(m)
    );
    socket.on('private-message.deleted', (m) =>
      this.traiterMessageDmSupprime(m)
    );
    socket.on('room-message.created', (m) =>
      this.traiterMessageSalonEntrant(m)
    );
    socket.on('room-message.updated', (m) =>
      this.traiterMessageSalonModifie(m)
    );
    socket.on('room-message.deleted', (m) =>
      this.traiterMessageSalonSupprime(m)
    );
    socket.on('typing', (evt) => this.traiterSaisieEntrante(evt));
    // Présence en temps réel (voir Message-Service, 'presence.changed').
    socket.on('presence.changed', (evt) => this.traiterPresenceEntrante(evt));
    socket.on('profil.changed', (evt) => this.traiterProfilEntrant(evt));
    socket.on('serveur.change', (evt) => this.traiterServeurEntrant(evt));
    socket.on('read-state.updated', (evt) => {
      void this.traiterLectureEntrante(evt);
    });
    // Accès à un salon perdu (expulsion, salon réservé…) : Message-Service a
    // retiré ce socket de la room. On l'oublie pour pouvoir la rejoindre de
    // nouveau si l'accès revient (voir rejoindreSocketSalon).
    socket.on('room-message.revoked', (evt) => {
      if (typeof evt?.roomId === 'string') {
        this.roomsSocketRejointes.delete(evt.roomId);
      }
    });

    // Jeton refusé par Message-Service (révoqué, expiré), juste avant qu'il
    // ne ferme le socket : on vérifie la session (voir
    // verifierSessionApres401) au lieu de se reconnecter en boucle avec un
    // jeton mort. Si elle est bien morte, retour à l'écran de connexion.
    socket.on('session.revoquee', () => {
      if (this.socket !== socket) return;
      void this.verifierSessionApres401();
    });

    // Le garde `this.socket !== socket` ignore les événements d'un socket
    // déjà remplacé ou fermé volontairement (voir fermerSocket).
    socket.on('disconnect', () => {
      if (this.socket !== socket) return;
      this.enLigneTempsReel = null;
      this.planifierReconnexion();
    });

    // Avec `reconnection: false`, un échec de connexion n'émet QUE
    // 'connect_error' (jamais 'disconnect') : sans ce rappel, une tentative
    // ratée laissait l'app bloquée indéfiniment sur "Reconnexion…".
    socket.on('connect_error', () => {
      if (this.socket !== socket) return;
      this.planifierReconnexion();
    });
  },

  rejoindreSocketSalon(salonId) {
    const socket = this.socket;
    // Socket pas encore authentifié : le salon (déjà dans salonsRejoints)
    // sera rejoint à la réception de 'connexion.prete'.
    if (!socket || !this.socketPret || this.roomsSocketRejointes.has(salonId)) {
      return;
    }
    // Marqué tout de suite (évite les doublons pendant l'attente), puis
    // oublié si Message-Service ne confirme pas : accès refusé (il n'appelle
    // alors pas l'accusé de réception) ou Room-Service trop lent. Le salon
    // sera redemandé au prochain obtenirEtat / à la prochaine reconnexion,
    // au lieu de rester à tort « rejoint » sans jamais recevoir de message.
    this.roomsSocketRejointes.add(salonId);
    socket
      .timeout(DELAI_ACK_REJOINDRE_SALON_MS)
      .emit('room-message.join', { roomId: salonId }, (erreur, reponse) => {
        if (this.socket !== socket) return;
        if (erreur || reponse?.joined !== true) {
          this.roomsSocketRejointes.delete(salonId);
        }
      });
  },

  traiterMessageDmEntrant(brut) {
    const message = this.mapperMessageDm(brut);
    this.indexMessages.set(message.id, { type: 'dm' });
    this.partenairesDmConnus.add(
      this.autreParticipantDm(message.conversationId)
    );
    this.emettre('message-recu', { conversationType: 'dm', message });
  },

  traiterMessageDmModifie(brut) {
    const message = this.mapperMessageDm(brut);
    this.indexMessages.set(message.id, { type: 'dm' });
    this.emettre('message-modifie', message);
  },

  traiterMessageDmSupprime(brut) {
    this.indexMessages.delete(brut.id);
    this.emettre('message-supprime', { messageId: brut.id });
  },

  traiterMessageSalonEntrant(brut) {
    const message = this.mapperMessageSalon(brut);
    this.indexMessages.set(message.id, { type: 'salon', roomId: brut.roomId });
    this.emettre('message-recu', {
      conversationType: 'salon',
      salonId: brut.roomId,
      serveurId: this.salonVersServeur.get(brut.roomId) ?? null,
      message,
    });
  },

  traiterMessageSalonModifie(brut) {
    const message = this.mapperMessageSalon(brut);
    this.indexMessages.set(message.id, { type: 'salon', roomId: brut.roomId });
    this.emettre('message-modifie', message);
  },

  traiterMessageSalonSupprime(brut) {
    this.indexMessages.delete(brut.id);
    this.emettre('message-supprime', { messageId: brut.id });
  },

  traiterSaisieEntrante(evt) {
    if (!evt || !this.utilisateurConnecte) return;
    const conversationId =
      evt.scope === 'dm'
        ? creerDmId(this.utilisateurConnecte.id, evt.userId)
        : evt.targetId;
    const etat = {
      conversationId,
      utilisateurId: evt.userId,
      est_saisie: Boolean(evt.isTyping),
    };
    const index = this.etatsSaisie.findIndex(
      (item) =>
        item.conversationId === etat.conversationId &&
        item.utilisateurId === etat.utilisateurId
    );
    if (index !== -1) this.etatsSaisie[index] = etat;
    else this.etatsSaisie.push(etat);
    this.emettre('saisie', etat);
  },
};
