'use strict';

// runtime/configuration.js — Configuration utilisateur (alias, thème, langue, notifications).
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.

module.exports = {
  // --- Configuration utilisateur (alias, thème, langue, notifications) --------

  mapperConfig(brut) {
    return {
      alias: brut.alias ?? null,
      theme: brut.theme,
      langue: brut.langue,
      statutPresence:
        brut.statutPresence === 'enLigne' ? 'en-ligne' : 'hors-ligne',
      vuLaDerniereFois: brut.vuLaDerniereFois ?? null,
      modeNotification: brut.modeNotification,
      avatar: brut.avatar ?? null,
    };
  },

  async configObtenir() {
    const config = this.mapperConfig(
      await this.appelHttp('/api/config-utilisateur')
    );
    this.memoriserProfilSoi(config);
    return config;
  },

  async configModifier({ alias, theme, langue, modeNotification, avatar }) {
    const corps = {};
    // Chaîne vide = retirer l'avatar (même convention que l'alias).
    if (avatar !== undefined) corps.avatar = avatar ?? '';
    if (alias !== undefined) corps.alias = alias;
    if (theme !== undefined) corps.theme = theme;
    if (langue !== undefined) corps.langue = langue;
    if (modeNotification !== undefined)
      corps.modeNotification = modeNotification;
    const config = this.mapperConfig(
      await this.appelHttp('/api/config-utilisateur', {
        methode: 'PATCH',
        corps,
      })
    );
    this.memoriserProfilSoi(config);
    // Seuls l'alias et l'avatar sont visibles des autres (pas le thème…).
    if (alias !== undefined || avatar !== undefined) this.annoncerProfil();
    return config;
  },

  /** Signale aux autres clients que notre profil public a changé. */
  annoncerProfil() {
    if (this.socketPret && this.socket?.connected) {
      this.socket.emit('profil.update');
    }
  },

  /**
   * Profil d'un autre utilisateur modifié ('profil.changed') : on recharge
   * son pseudo (Authentification) et son alias/avatar (User-Config-Service).
   * 'profils-publics' est émis si quelque chose a changé, pour que l'UI
   * redessine.
   */
  async rafraichirProfil(utilisateurId) {
    const pseudoAvant = this.utilisateursConnus.get(utilisateurId)?.pseudo;
    await Promise.all([
      this.resoudrePseudosInconnus([utilisateurId]),
      this.chargerProfilsPublics([utilisateurId]),
    ]);
    const pseudoApres = this.utilisateursConnus.get(utilisateurId)?.pseudo;
    if (pseudoAvant !== undefined && pseudoAvant !== pseudoApres) {
      this.emettre('profils-publics', [utilisateurId]);
    }
  },

  traiterProfilEntrant(evt) {
    const id = evt?.userId;
    if (typeof id !== 'string' || id === this.utilisateurConnecte?.id) return;
    // Uniquement les utilisateurs qu'on affiche déjà quelque part.
    if (!this.utilisateursConnus.has(id) && !this.profilsPublics.has(id))
      return;
    void this.rafraichirProfil(id);
  },

  /**
   * Changement dans un de nos serveurs, signalé par Room-Service via
   * Message-Service : relayé aux pages ('serveur-change'), qui rechargent.
   */
  traiterServeurEntrant(evt) {
    if (typeof evt?.serveurId !== 'string' || typeof evt.raison !== 'string') {
      return;
    }
    // Serveur par défaut : tout le monde en est membre. Un changement de
    // membre qui ne nous vise pas (rôle d'un autre…) ne change rien à notre
    // page : on ne la recharge pas, sinon chaque changement ferait recharger
    // la page de tous les clients connectés.
    if (
      evt.raison === 'membres' &&
      evt.cibleId !== this.utilisateurConnecte?.id &&
      this.serveurs.get(evt.serveurId)?.parDefaut
    ) {
      return;
    }
    this.emettre('serveur-change', {
      serveurId: evt.serveurId,
      raison: evt.raison,
      cibleId: typeof evt.cibleId === 'string' ? evt.cibleId : null,
    });
  },
};
