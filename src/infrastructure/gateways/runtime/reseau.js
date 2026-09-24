'use strict';

// runtime/reseau.js — Réseau : reconnexion automatique, réveil, battement de cœur ; état de saisie.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const {
  CAUSE_HORS_LIGNE,
  CAUSE_SERVEUR_INJOIGNABLE,
  DELAI_BATTEMENT_COEUR_MS,
  DELAI_RECONNEXION_INITIAL_MS,
  DELAI_RECONNEXION_MAX_MS,
  INTERVALLE_BATTEMENT_COEUR_MS,
} = require('./constantes');

module.exports = {
  // --- Réseau : reconnexion automatique ------------------------------------------
  // Trois sources de vérité, combinées ici :
  //  - le socket Socket.IO lui-même ('connect' / 'disconnect' / 'connect_error') ;
  //  - l'état réseau du système d'exploitation, relayé par main.js
  //    (net.isOnline / powerMonitor, voir signalerReseauSysteme/signalerReveil) :
  //    inutile de marteler le serveur quand la machine n'a pas de réseau ;
  //  - un battement de cœur HTTP (GET /api/health) tant qu'on est connecté,
  //    pour détecter un socket "zombie" bien avant le ping/pong Socket.IO.

  sessionActive() {
    return Boolean(this.jeton && this.utilisateurConnecte);
  },

  /** Ferme le socket courant SANS déclencher de reconnexion (voir le garde
   * `this.socket !== socket` dans les écouteurs de connecterSocket). */
  fermerSocket() {
    const socket = this.socket;
    this.socket = null;
    this.socketPret = false;
    clearTimeout(this.minuteurRepliConnexionPrete);
    // Plus de flux temps réel : l'instantané de présence n'est plus fiable.
    this.enLigneTempsReel = null;
    clearTimeout(this.minuteurSuiviPresence);
    this.minuteurSuiviPresence = null;
    this.cleSuiviPresence = null;
    socket?.disconnect();
  },

  annulerReconnexionPlanifiee() {
    if (this.minuteurReconnexion) clearTimeout(this.minuteurReconnexion);
    this.minuteurReconnexion = null;
  },

  /**
   * Planifie la prochaine tentative de connexion avec un délai exponentiel
   * (1 s, 2 s, 4 s… plafonné à DELAI_RECONNEXION_MAX_MS). Idempotente : un
   * `disconnect` suivi d'un `connect_error` ne planifie qu'une seule tentative.
   */
  planifierReconnexion() {
    if (!this.sessionActive() || this.fermetureVoulue) return;
    this.arreterBattementCoeur();
    if (this.horsLigneSysteme) {
      this.definirEtatConnexion('deconnecte', { cause: CAUSE_HORS_LIGNE });
      return;
    }
    if (this.minuteurReconnexion) return;
    const delai = this.delaiReconnexionActuelMs;
    this.delaiReconnexionActuelMs = Math.min(
      this.delaiReconnexionActuelMs * 2,
      DELAI_RECONNEXION_MAX_MS
    );
    this.definirEtatConnexion('reconnexion', {
      cause: CAUSE_SERVEUR_INJOIGNABLE,
      prochaineTentative: Date.now() + delai,
    });
    this.minuteurReconnexion = setTimeout(() => {
      this.minuteurReconnexion = null;
      if (
        !this.sessionActive() ||
        this.fermetureVoulue ||
        this.horsLigneSysteme
      )
        return;
      this.reconnexions += 1;
      this.definirEtatConnexion('reconnexion', {
        cause: CAUSE_SERVEUR_INJOIGNABLE,
      });
      this.connecterSocket();
    }, delai);
  },

  /** Bouton "Réessayer maintenant" : saute le délai en cours et repart d'un
   * backoff minimal. Sans effet (hors état) si la machine est hors ligne. */
  reconnecterMaintenant() {
    if (!this.sessionActive()) return this.obtenirEtatConnexion();
    this.annulerReconnexionPlanifiee();
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    this.fermetureVoulue = false;
    if (this.horsLigneSysteme) {
      return this.definirEtatConnexion('deconnecte', {
        cause: CAUSE_HORS_LIGNE,
      });
    }
    this.definirEtatConnexion('reconnexion', {
      cause: this.etatConnexion.cause ?? CAUSE_SERVEUR_INJOIGNABLE,
    });
    this.connecterSocket();
    return this.obtenirEtatConnexion();
  },

  /** Relayé par main.js à chaque changement de connectivité de l'OS. */
  signalerReseauSysteme(enLigne) {
    const etaitHorsLigne = this.horsLigneSysteme;
    this.horsLigneSysteme = !enLigne;
    if (!enLigne) {
      if (etaitHorsLigne) return;
      this.annulerReconnexionPlanifiee();
      this.arreterBattementCoeur();
      this.fermerSocket();
      if (this.sessionActive()) {
        this.definirEtatConnexion('deconnecte', { cause: CAUSE_HORS_LIGNE });
      }
      return;
    }
    if (etaitHorsLigne) this.reconnecterMaintenant();
  },

  /** Sortie de veille : le socket d'avant la mise en veille est presque
   * toujours mort sans le savoir, on en ouvre un neuf immédiatement. */
  signalerReveil() {
    if (this.sessionActive() && !this.fermetureVoulue) {
      this.reconnecterMaintenant();
    }
  },

  demarrerBattementCoeur() {
    this.arreterBattementCoeur();
    this.minuteurBattementCoeur = setInterval(async () => {
      if (this.etatConnexion.statut !== 'connecte') return;
      const socket = this.socket;
      try {
        const reponse = await this.fetchAvecDelai(
          `${this.baseUrlHttp}/api/health`,
          DELAI_BATTEMENT_COEUR_MS
        );
        if (!reponse.ok) throw new Error(`ERR_HTTP_${reponse.status}`);
      } catch {
        // Le socket a pu être remplacé pendant l'appel : n'agir que s'il
        // s'agit toujours du même.
        if (this.socket !== socket || this.etatConnexion.statut !== 'connecte')
          return;
        this.fermerSocket();
        this.planifierReconnexion();
      }
    }, INTERVALLE_BATTEMENT_COEUR_MS);
  },

  arreterBattementCoeur() {
    if (this.minuteurBattementCoeur) clearInterval(this.minuteurBattementCoeur);
    this.minuteurBattementCoeur = null;
  },

  fetchAvecDelai(url, delaiMs) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), delaiMs);
    return fetch(url, { signal: controleur.signal }).finally(() =>
      clearTimeout(minuteur)
    );
  },

  // --- État de saisie (Socket.IO, éphémère) --------------------------------------

  async modifierEtatSaisie({ conversationId, est_saisie }) {
    this.verifierReseauConnecte();
    if (!this.socket || !this.socket.connected) {
      throw new Error('ERR_RESEAU_NON_CONNECTE');
    }
    const estDm = String(conversationId).includes(':');
    const scope = estDm ? 'dm' : 'room';
    const targetId = estDm
      ? this.autreParticipantDm(conversationId)
      : conversationId;
    this.socket.emit('typing', {
      scope,
      targetId,
      isTyping: Boolean(est_saisie),
    });
    return {
      conversationId,
      utilisateurId: this.utilisateurConnecte?.id,
      est_saisie: Boolean(est_saisie),
    };
  },

  obtenirEtatsSaisie(param) {
    const id = typeof param === 'string' ? param : param?.conversationId;
    if (!id) return [];
    return this.etatsSaisie
      .filter((item) => item.conversationId === id)
      .map((item) => ({ ...item }));
  },
};
