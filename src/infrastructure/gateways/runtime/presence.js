'use strict';

// runtime/presence.js — Présence (la sienne, celle des autres) et sondage de secours.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const {
  DELAI_ACK_REJOINDRE_SALON_MS,
  DELAI_SUIVI_PRESENCE_MS,
  INTERVALLE_POLL_PRESENCE_MS,
  MAX_PRESENCES_SUIVIES,
} = require('./constantes');

module.exports = {
  // --- Présence -----------------------------------------------------------------

  /**
   * Abonne le socket à la présence des utilisateurs connus de l'app (ceux
   * qu'elle affiche : membres, auteurs, conversations…), les plus récents
   * d'abord, 500 au plus. Message-Service n'envoie plus 'presence.changed'
   * qu'aux clients qui suivent l'utilisateur. Sans effet si la liste n'a pas
   * changé ; retenté plus tard en cas d'échec.
   */
  suivrePresence() {
    clearTimeout(this.minuteurSuiviPresence);
    this.minuteurSuiviPresence = null;
    const socket = this.socket;
    if (!socket || !this.socketPret) return;
    const moi = this.utilisateurConnecte?.id;
    const ids = [...this.utilisateursConnus.keys()]
      .filter((id) => id !== moi)
      .slice(-MAX_PRESENCES_SUIVIES);
    const cle = ids.join(',');
    if (cle === this.cleSuiviPresence) return;
    this.cleSuiviPresence = cle;
    socket
      .timeout(DELAI_ACK_REJOINDRE_SALON_MS)
      .emit('presence.suivre', { ids }, (erreur, reponse) => {
        if (this.socket !== socket) return;
        if (erreur) {
          // Refusée (trop rapprochée) ou sans réponse : on redemandera.
          this.cleSuiviPresence = null;
          this.planifierSuiviPresence();
          return;
        }
        this.traiterInstantanePresence(reponse, ids);
      });
  },

  /** Regroupe les demandes (voir DELAI_SUIVI_PRESENCE_MS). */
  planifierSuiviPresence() {
    if (this.minuteurSuiviPresence) return;
    this.minuteurSuiviPresence = setTimeout(
      () => this.suivrePresence(),
      DELAI_SUIVI_PRESENCE_MS
    );
  },

  definirPresenceInterne({ utilisateurId, statut }) {
    this.presences[utilisateurId] = statut;
    const presence = { utilisateurId, statut, vuLaDerniereFois: Date.now() };
    this.emettre('presence', presence);
    return presence;
  },

  async modifierPresence({ statut }) {
    this.verifierReseauConnecte();
    await this.appelHttp('/api/config-utilisateur/presence', {
      methode: 'PUT',
      corps: { statut: statut === 'en-ligne' ? 'enLigne' : 'horsLigne' },
    });
    const presence = this.definirPresenceInterne({
      utilisateurId: this.utilisateurConnecte.id,
      statut,
    });
    this.annoncerPresence();
    return presence;
  },

  /**
   * Relaie notre présence aux autres clients en temps réel (Message-Service
   * la diffuse via 'presence.changed'), une fois qu'elle est connue et le
   * socket ouvert. User-Config-Service reste la source de vérité ; le
   * sondage réconcilie toutes les 20 s.
   */
  annoncerPresence() {
    const statut = this.presences[this.utilisateurConnecte?.id];
    if (!statut || !this.socketPret || !this.socket?.connected) return;
    this.socket.emit('presence.update', { statut });
  },

  /**
   * Instantané reçu à la connexion du socket : utilisateurs actuellement en
   * ligne. Tout autre utilisateur connu est hors ligne, y compris ceux qui ont
   * quitté juste avant (dont on n'a pas reçu l'annonce).
   */
  /**
   * Qui est en ligne parmi `suivis` (réponse à 'presence.suivre') : les
   * autres suivis sont hors ligne. Sans `suivis`, parmi tous les
   * utilisateurs connus.
   */
  traiterInstantanePresence(evt, suivis) {
    if (
      !Array.isArray(evt?.enLigne) ||
      !evt.enLigne.every((id) => typeof id === 'string')
    ) {
      return;
    }
    this.enLigneTempsReel = new Set(evt.enLigne);
    const moi = this.utilisateurConnecte?.id;
    const connus = new Set([
      ...(suivis ?? [
        ...this.utilisateursConnus.keys(),
        ...Object.keys(this.presences),
      ]),
      ...evt.enLigne,
    ]);
    for (const id of connus) {
      if (id === moi) continue;
      const statut = this.enLigneTempsReel.has(id) ? 'en-ligne' : 'hors-ligne';
      if (this.presences[id] !== statut) {
        this.definirPresenceInterne({ utilisateurId: id, statut });
      }
    }
  },

  traiterPresenceEntrante(evt) {
    if (
      typeof evt?.userId !== 'string' ||
      (evt.statut !== 'en-ligne' && evt.statut !== 'hors-ligne')
    ) {
      return;
    }
    if (evt.statut === 'hors-ligne') {
      this.horsLigneTempsReel.set(evt.userId, Date.now());
      this.enLigneTempsReel?.delete(evt.userId);
    } else {
      this.horsLigneTempsReel.delete(evt.userId);
      this.enLigneTempsReel?.add(evt.userId);
    }
    if (this.presences[evt.userId] !== evt.statut) {
      this.definirPresenceInterne({
        utilisateurId: evt.userId,
        statut: evt.statut,
      });
    }
  },

  /**
   * Présences connues : la nôtre (statut choisi, voir demarrerPollPresence)
   * et celles des autres utilisateurs connus (présence effective, voir
   * chargerProfilsPublics). Hors ligne par défaut tant qu'elle n'est pas
   * chargée, plutôt que d'afficher un statut qu'on ne connaît pas.
   */
  obtenirPresences() {
    const carte = {};
    for (const id of this.utilisateursConnus.keys()) {
      carte[id] = this.presences[id] ?? 'hors-ligne';
    }
    if (this.utilisateurConnecte) {
      carte[this.utilisateurConnecte.id] =
        this.presences[this.utilisateurConnecte.id] ?? 'en-ligne';
    }
    return carte;
  },

  /**
   * Toutes les 20 s, tant qu'une session est ouverte :
   *  1. relit notre configuration (statut choisi, éventuellement modifié
   *     depuis un autre appareil) ;
   *  2. si on est `enLigne`, renvoie ce statut au serveur : c'est notre
   *     signe de vie (rafraîchit vuLaDerniereFois). Sans lui, le serveur nous
   *     considère absent au bout de 90 s (voir `actif`) ;
   *  3. rafraîchit la présence (et, un tour sur N, l'avatar) des autres
   *     utilisateurs connus.
   * Un compte qui n'a jamais défini sa présence (vuLaDerniereFois nul)
   * passe `enLigne` par défaut à la première connexion.
   */
  demarrerPollPresence() {
    this.arreterPollPresence();
    const rafraichir = async () => {
      if (!this.utilisateurConnecte) return;
      try {
        const config = await this.configObtenir();
        const jamaisDefinie = config.vuLaDerniereFois === null;
        const statut = jamaisDefinie ? 'en-ligne' : config.statutPresence;
        if (statut === 'en-ligne') {
          await this.appelHttp('/api/config-utilisateur/presence', {
            methode: 'PUT',
            corps: { statut: 'enLigne' },
          });
        }
        if (this.presences[this.utilisateurConnecte.id] !== statut) {
          this.definirPresenceInterne({
            utilisateurId: this.utilisateurConnecte.id,
            statut,
          });
          // Changée ailleurs (autre appareil) ou connue pour la première fois.
          this.annoncerPresence();
        }
      } catch {
        // Best-effort : un échec de poll ne doit pas interrompre l'app.
      }
      const autres = [...this.utilisateursConnus.keys()];
      const avecAvatars = this.avatarsARafraichir;
      this.avatarsARafraichir = false;
      // Tant que le temps réel fonctionne (socket prêt, instantané reçu), la
      // présence des autres arrive déjà par 'presence.changed' : inutile de
      // réinterroger tous les utilisateurs connus toutes les 20 s (des
      // centaines sur le serveur par défaut). Sondage complet seulement
      // sans temps réel, ou pour rattraper les photos après une reconnexion.
      const tempsReelActif = this.socketPret && this.enLigneTempsReel !== null;
      if (autres.length && (!tempsReelActif || avecAvatars)) {
        await this.chargerProfilsPublics(autres, {
          inclureAvatar: avecAvatars,
        });
      }
    };
    this.minuteurPollPresence = setInterval(
      rafraichir,
      INTERVALLE_POLL_PRESENCE_MS
    );
    void rafraichir();
  },

  arreterPollPresence() {
    if (this.minuteurPollPresence) clearInterval(this.minuteurPollPresence);
    this.minuteurPollPresence = null;
  },
};
