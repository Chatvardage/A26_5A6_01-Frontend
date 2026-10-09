'use strict';

// runtime/session.js — Session (connexion, inscription, reprise, session expirée) et profil.
// Méthodes de RealGatewayRuntime, ajoutées à son prototype (voir
// RealGatewayRuntime.js) : `this` est l'instance.
const { DELAI_RECONNEXION_INITIAL_MS } = require('./constantes');

module.exports = {
  // --- Session / authentification --------------------------------------------

  /**
   * Convertit un utilisateur tel que retourné par Authentification (champs en
   * français : pseudo, courriel, role, cree_le, modifie_le) vers la forme
   * utilisée par le domaine Frontend.
   */
  mapperUtilisateur(brut) {
    return {
      id: brut.id,
      pseudo: brut.pseudo,
      courriel: brut.courriel,
      role: brut.role,
    };
  },

  ouvrirSession({ utilisateur, jeton }) {
    this.jeton = jeton;
    this.utilisateurConnecte = this.mapperUtilisateur(utilisateur);
    this.enregistrerUtilisateurConnu(this.utilisateurConnecte);
    this.sauvegarderJetonPersiste(jeton);
    this.fermetureVoulue = false;
    this.annulerReconnexionPlanifiee();
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    // L'appel HTTP qui vient de réussir prouve que le serveur est joignable :
    // 'connecte' tout de suite, le socket prendra le relais (et planifiera
    // une reconnexion s'il n'arrive pas à s'ouvrir).
    this.horsLigneSysteme = false;
    const etatConnexion = this.definirEtatConnexion('connecte');
    this.connecterSocket();
    this.demarrerPollPresence();
    return { utilisateur: this.utilisateurConnecte, etatConnexion };
  },

  /**
   * Authentifie un utilisateur déjà inscrit, par pseudo OU courriel + mot de
   * passe (voir "identifiant" côté LoginPage.tsx).
   */
  async authentifier({ identifiant, motDePasse }) {
    const reponse = await this.appelHttp('/api/auth/login', {
      methode: 'POST',
      corps: { identifiant, mot_de_passe: motDePasse },
    });
    return this.ouvrirSession(reponse);
  },

  /**
   * Inscrit un nouvel utilisateur (courriel + mot de passe, pseudo par
   * défaut généré côté renderer — voir genererPseudoParDefaut). Le backend
   * exige un pseudo unique dès l'inscription (contrairement à l'ancien
   * contrat fictif) : sur conflit (409, pseudo probablement déjà pris par un
   * autre compte), on retente automatiquement avec un pseudo légèrement
   * randomisé plutôt que de faire échouer l'inscription pour une collision
   * sur une valeur que l'utilisateur n'a de toute façon pas choisie
   * lui-même — il pourra la changer ensuite sur l'écran "Choisis ton pseudo"
   * (voir InscriptionPage.tsx) ou la page profil.
   *
   * UNE seule relance : Authentification renvoie le même 409 pour un pseudo
   * OU un courriel déjà pris. Si le pseudo randomisé (quasi sûrement libre)
   * est lui aussi refusé, c'est le courriel : inutile d'insister, chaque
   * tentative compte dans la limite du Gateway (10 inscriptions / min) et
   * le message finirait en « trop de tentatives » au lieu de « déjà utilisé ».
   */
  async inscrire({ courriel, motDePasse, pseudo }) {
    const TENTATIVES_MAX = 2;
    let pseudoTente = pseudo;
    for (let tentative = 0; tentative < TENTATIVES_MAX; tentative += 1) {
      try {
        const reponse = await this.appelHttp('/api/auth/register', {
          methode: 'POST',
          corps: { pseudo: pseudoTente, courriel, mot_de_passe: motDePasse },
        });
        return this.ouvrirSession(reponse);
      } catch (erreur) {
        if (erreur.statut !== 409) throw erreur;
        const suffixe = String(Math.floor(1000 + Math.random() * 9000));
        pseudoTente = `${pseudo}`.slice(0, 20 - suffixe.length) + suffixe;
      }
    }
    // Deux 409 : c'est le courriel (voir plus haut). ERR_HTTP_409 se
    // traduisait par « Ce pseudo est déjà pris », message trompeur ici.
    const erreur = new Error('ERR_COURRIEL_DEJA_UTILISE');
    erreur.statut = 409;
    throw erreur;
  },

  /**
   * Tente de reprendre une session déjà ouverte lors d'un lancement
   * précédent (jeton persisté sur disque, voir chargerJetonPersiste),
   * validée via `GET /api/auth/me`. Retourne `null` si aucun jeton n'est
   * persisté, ou si le jeton n'est plus valide (expiré, révoqué, compte
   * supprimé) — dans ce dernier cas le jeton invalide est purgé.
   */
  async restaurerSession() {
    const jeton = this.chargerJetonPersiste();
    if (!jeton) return null;
    this.jeton = jeton;
    try {
      const utilisateur = await this.appelHttp('/api/auth/me');
      return this.ouvrirSession({ utilisateur, jeton });
    } catch (erreur) {
      this.jeton = null;
      // Ne purger le jeton que s'il est réellement refusé : un lancement
      // hors ligne ne doit pas déconnecter définitivement l'utilisateur.
      if (
        erreur?.statut === 401 ||
        erreur?.statut === 403 ||
        erreur?.statut === 404
      ) {
        this.sauvegarderJetonPersiste(null);
      }
      return null;
    }
  },

  /**
   * « Se déconnecter partout » : Auth invalide tous les jetons du compte
   * (ceux des autres appareils compris), puis la session locale est fermée
   * comme pour une déconnexion normale. En cas d'échec (hors ligne), rien
   * n'est fermé : l'appelant affiche l'erreur.
   */
  async deconnexionPartout() {
    this.verifierReseauConnecte();
    await this.appelHttp('/api/auth/logout-all', { methode: 'POST' });
    await this.deconnexion();
  },

  /**
   * « Déconnecter les autres appareils » : Auth invalide tous les jetons du
   * compte et renvoie une nouvelle session pour celui-ci, qui reste
   * connecté (le socket repart avec le nouveau jeton). Message-Service ferme
   * aussitôt les sockets des autres appareils.
   */
  async deconnexionAutres() {
    this.verifierReseauConnecte();
    this.rotationJetonEnCours = true;
    try {
      const reponse = await this.appelHttp('/api/auth/logout-others', {
        methode: 'POST',
      });
      if (typeof reponse?.jeton !== 'string' || !reponse.jeton.trim()) {
        throw new Error('ERR_RECONNEXION_REQUISE');
      }
      this.jeton = reponse.jeton;
      this.sauvegarderJetonPersiste(reponse.jeton);
      this.connecterSocket();
    } finally {
      this.rotationJetonEnCours = false;
    }
  },

  async deconnexion() {
    // Une réponse encore en route (ex. chargerServeurs) appartient à la
    // session qui se ferme : voir sessionCourante dans serveurs.js.
    this.generationSession += 1;
    this.fermetureVoulue = true;
    this.arreterPollPresence();
    this.annulerReconnexionPlanifiee();
    this.arreterBattementCoeur();
    this.fermerSocket();
    this.jeton = null;
    this.utilisateurConnecte = null;
    this.sauvegarderJetonPersiste(null);
    // `chatGateway` est une instance UNIQUE qui survit à une déconnexion
    // (voir main.js) : si un⋅e autre utilisateur⋅rice se connecte ensuite
    // dans la même session Electron, tout cache laissé ici (utilisateurs
    // connus, présences, index de messages, salons/DM déjà rejoints, états
    // de saisie) appartiendrait à la session PRÉCÉDENTE — à réinitialiser
    // systématiquement pour repartir sur une base propre.
    this.utilisateursConnus.clear();
    this.presences = {};
    this.profilsPublics.clear();
    this.avatarsARafraichir = false;
    this.dejaConnecte = false;
    this.horsLigneTempsReel.clear();
    this.enLigneTempsReel = null;
    this.indexMessages.clear();
    this.salonsRejoints.clear();
    this.roomsSocketRejointes.clear();
    this.partenairesDmConnus.clear();
    this.serveurs.clear();
    this.salonVersServeur.clear();
    this.etatsSaisie = [];
    this.definirEtatConnexion('deconnecte');
  },

  /**
   * Un 401 ne veut pas toujours dire « session expirée » : Authentification
   * répond aussi 401 pour un mot de passe actuel incorrect (changement de mot
   * de passe, suppression du compte). On revérifie donc le jeton lui-même
   * (`GET /api/auth/me`) : s'il est refusé (expiré après 24 h, révoqué par un
   * changement de mot de passe sur un autre appareil…), la session est
   * fermée et 'session-expiree' est émis — main.js ramène alors l'app à
   * l'écran de connexion. Une seule vérification à la fois ; une erreur
   * réseau ne permet de rien conclure.
   */
  async verifierSessionApres401() {
    // Jetons de cet appareil en cours de remplacement (mot de passe changé,
    // autres appareils déconnectés) : le refus de l'ancien jeton est attendu,
    // la session continue avec le nouveau.
    if (this.verificationSessionEnCours || this.rotationJetonEnCours) return;
    this.verificationSessionEnCours = true;
    const jeton = this.jeton;
    try {
      const reponse = await fetch(`${this.baseUrlHttp}/api/auth/me`, {
        headers: { Authorization: `Bearer ${jeton}` },
      });
      if (reponse.status === 401 && this.jeton === jeton) {
        await this.deconnexion();
        this.emettre('session-expiree');
      }
    } catch {
      // Réseau indisponible : rien à conclure, la session est gardée.
    } finally {
      this.verificationSessionEnCours = false;
    }
  },

  /** Utilisateur authentifié courant, ou `null` si personne n'est connecté. */
  obtenirUtilisateurConnecte() {
    return this.utilisateurConnecte ? { ...this.utilisateurConnecte } : null;
  },

  // --- Profil (page "Modifier le profil") -------------------------------------

  async profilObtenir() {
    const brut = await this.appelHttp('/api/auth/me');
    const utilisateur = this.mapperUtilisateur(brut);
    this.utilisateurConnecte = utilisateur;
    this.enregistrerUtilisateurConnu(utilisateur);
    return utilisateur;
  },

  /**
   * Change uniquement le pseudo (3-20 caractères, unicité vérifiée par le
   * serveur) — pas besoin du mot de passe actuel pour ce champ seul (voir
   * contrat Authentification : `mot_de_passe_actuel` n'est requis que si
   * `courriel` et/ou `mot_de_passe` sont fournis).
   */
  async profilModifierPseudo(pseudo) {
    const brut = await this.appelHttp('/api/auth/me', {
      methode: 'PATCH',
      corps: { pseudo },
    });
    const utilisateur = this.mapperUtilisateur(brut);
    this.utilisateurConnecte = utilisateur;
    this.enregistrerUtilisateurConnu(utilisateur);
    this.annoncerProfil();
    return utilisateur;
  },

  /**
   * Change le mot de passe (le courriel n'est pas modifiable) — le mot de passe ACTUEL est
   * obligatoire ici (vérifié par le serveur), pour empêcher qu'un jeton volé
   * ne permette une prise de contrôle permanente du compte.
   */
  async profilModifierCompte({ motDePasse, motDePasseActuel }) {
    // Pas de courriel : Authentification refuse de le modifier via /me.
    const corps = { mot_de_passe_actuel: motDePasseActuel };
    if (motDePasse !== undefined) corps.mot_de_passe = motDePasse;
    // Nouveau mot de passe : tous les jetons sont invalidés, celui-ci compris
    // (voir verifierSessionApres401 et renouvelerJetonApresChangementMotDePasse).
    this.rotationJetonEnCours = motDePasse !== undefined;
    try {
      const brut = await this.appelHttp('/api/auth/me', {
        methode: 'PATCH',
        corps,
      });
      const utilisateur = this.mapperUtilisateur(brut);
      this.utilisateurConnecte = utilisateur;
      this.enregistrerUtilisateurConnu(utilisateur);
      if (motDePasse !== undefined) {
        await this.renouvelerJetonApresChangementMotDePasse(
          utilisateur.courriel,
          motDePasse
        );
      }
      return utilisateur;
    } finally {
      this.rotationJetonEnCours = false;
    }
  },

  /**
   * Authentification révoque TOUS les jetons existants quand le mot de passe
   * change (`version_auth` incrémentée) — y compris celui de cette session :
   * sans nouveau jeton, chaque requête suivante échouait en 401. On se
   * reconnecte donc avec le nouveau mot de passe, puis on rouvre le socket
   * (authentifié avec l'ancien jeton). Si cette reconnexion échoue, le mot
   * de passe est bien changé mais la session est perdue : code dédié pour
   * que l'UI demande de se reconnecter.
   */
  async renouvelerJetonApresChangementMotDePasse(identifiant, motDePasse) {
    let reponse;
    try {
      reponse = await this.appelHttp('/api/auth/login', {
        methode: 'POST',
        corps: { identifiant, mot_de_passe: motDePasse },
      });
    } catch {
      throw new Error('ERR_RECONNEXION_REQUISE');
    }
    this.jeton = reponse.jeton;
    this.sauvegarderJetonPersiste(reponse.jeton);
    this.connecterSocket();
  },

  async profilSupprimerCompte(motDePasseActuel) {
    // Plus d'envoi périodique de présence pendant la suppression : un PUT
    // arrivé juste après recréerait dans User-Config une configuration pour
    // un compte qui n'existe plus (le Gateway mémorise l'identité ~10 s).
    this.arreterPollPresence();
    try {
      await this.appelHttp('/api/auth/me', {
        methode: 'DELETE',
        corps: { mot_de_passe_actuel: motDePasseActuel },
      });
    } catch (erreur) {
      // Mot de passe incorrect, hors ligne… : le compte existe toujours.
      if (this.sessionActive()) this.demarrerPollPresence();
      throw erreur;
    }
    await this.deconnexion();
  },
};
