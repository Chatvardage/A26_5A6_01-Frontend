'use strict';

// runtime/presence.js — Présence (la sienne, celle des autres) et sondage de secours.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const { INTERVALLE_POLL_PRESENCE_MS } = require('./constantes');

module.exports = {
  // --- Présence -----------------------------------------------------------------

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
  traiterInstantanePresence(evt) {
    if (
      !Array.isArray(evt?.enLigne) ||
      !evt.enLigne.every((id) => typeof id === 'string')
    ) {
      return;
    }
    this.enLigneTempsReel = new Set(evt.enLigne);
    const moi = this.utilisateurConnecte?.id;
    const connus = new Set([
      ...this.utilisateursConnus.keys(),
      ...Object.keys(this.presences),
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
