'use strict';

const { io } = require('socket.io-client');
const {
  CHEMINS_SANS_SESSION,
  DELAI_RECONNEXION_INITIAL_MS,
  creerDmId,
} = require('./runtime/constantes');
const {
  chargerJetonPersiste,
  sauvegarderJetonPersiste,
} = require('./runtime/jeton');
const { obtenirConfiguration } = require('../config/ConfigurationApi.js');

/**
 * RealGatewayRuntime — implémentation RÉELLE du contrat utilisé par main.js,
 * qui communique avec le Gateway ChatVardage (Serveur-API, voir
 * A26_5A6_01-Infra) par HTTP (REST) et Socket.IO (temps réel : nouveaux
 * messages, messages modifiés/supprimés, indicateur de saisie).
 *
 * Une seule identité par session : l'utilisateur authentifié. Les
 * paramètres `utilisateurId`/`hoteId` encore acceptés par certaines méthodes
 * ci-dessous, pour compatibilité avec les appels existants du renderer, sont
 * IGNORÉS : l'acteur réel est toujours l'utilisateur authentifié
 * (`this.utilisateurConnecte`), déduit du jeton JWT côté serveur.
 *
 * Présence et avatar des AUTRES utilisateurs : lus via
 * `GET /api/config-utilisateur/publiques` (voir chargerProfilsPublics), avec
 * la présence EFFECTIVE calculée par le serveur (`actif` : statut choisi
 * `enLigne` ET signe de vie récent — voir demarrerPollPresence, qui renvoie
 * le nôtre toutes les 20 s).
 */
class RealGatewayRuntime {
  constructor(config = obtenirConfiguration(), options = {}) {
    this.baseUrlHttp = config.baseUrlHttp;
    this.baseUrlSocket = config.baseUrlSocket;

    this.jeton = null;
    /** Utilisateur authentifié courant : { id, pseudo, courriel, role } | null */
    this.utilisateurConnecte = null;
    this.etatConnexion = {
      statut: 'deconnecte',
      depuis: Date.now(),
      reconnexions: 0,
    };
    this.reconnexions = 0;
    this.ecouteurs = new Map();
    this.socket = null;
    this.fermetureVoulue = false;
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    this.minuteurReconnexion = null;
    this.minuteurBattementCoeur = null;
    // Dernier état réseau connu du système d'exploitation (voir
    // signalerReseauSysteme) : optimiste par défaut.
    this.horsLigneSysteme = false;

    // Cache local des états de saisie reçus par Socket.IO (voir traiterSaisieEntrante).
    this.etatsSaisie = [];

    // Présences connues (voir obtenirPresences/definirPresenceInterne) — la
    // présence des AUTRES utilisateurs n'est jamais rafraîchie activement
    // (lacune backend, voir le commentaire de classe ci-dessus), seule la
    // nôtre (via User-Config-Service) est fiable.
    this.presences = {};

    // Profils publics connus (id -> { alias, avatar }), y compris le nôtre
    // (voir memoriserProfilSoi) — voir chargerProfilsPublics.
    this.profilsPublics = new Map();
    // Le sondage ne retélécharge PAS les photos (jusqu'à ~90 Ko chacune, pour
    // chaque utilisateur connu) : un changement arrive en temps réel
    // ('profil.changed', voir traiterProfilEntrant). Seule exception : après
    // une reconnexion du socket, un tour avec photos rattrape les changements
    // manqués pendant la coupure.
    this.avatarsARafraichir = false;
    // Vrai après la première connexion du socket de la session (voir 'connect').
    this.dejaConnecte = false;
    // Dernier « hors ligne » reçu en temps réel par utilisateur (id -> date),
    // voir DUREE_PRIORITE_HORS_LIGNE_MS.
    this.horsLigneTempsReel = new Map();
    // Utilisateurs en ligne selon Message-Service : réponse à
    // 'presence.suivre' (voir suivrePresence), tenue à jour par les
    // 'presence.changed'. Fait foi tant que le socket est connecté ; null
    // sinon (on revient alors au sondage seul).
    this.enLigneTempsReel = null;

    // Cache des utilisateurs "connus" (id -> {id, pseudo, role}), construit
    // opportunément (connexion, DM, événements temps réel) : il n'existe pas
    // de répertoire global d'utilisateurs côté backend (voir
    // obtenirUtilisateurs ci-dessous).
    this.utilisateursConnus = new Map();

    // Index local messageId -> { type: 'salon', roomId } | { type: 'dm' },
    // construit à chaque fois qu'un message est créé/listé/reçu : nécessaire
    // pour router modifierMessage/supprimerMessage vers le bon endpoint (les
    // messages de salon et les DM vivent sous des routes distinctes côté
    // Message-Service), alors que le renderer appelle un seul canal IPC
    // générique pour les deux (voir chat-ui-shared.js: creerActionsMessage).
    this.indexMessages = new Map();

    // Ids des salons dont on a rejoint la room Socket.IO durant cette session
    // (voir assurerAdhesionSocketSeulement / rejoindreSocketSalon).
    this.salonsRejoints = new Set();
    this.roomsSocketRejointes = new Set();
    // Vrai une fois le socket courant authentifié par Message-Service
    // ('connexion.prete', voir connecterSocket).
    this.socketPret = false;
    this.minuteurRepliConnexionPrete = null;
    // Vrai pendant la revérification du jeton après un 401 (voir
    // verifierSessionApres401).
    this.verificationSessionEnCours = false;

    // Partenaires de conversation privée connus localement cette session,
    // en complément de GET /api/messages/conversations (voir
    // obtenirConversationsPrivees) : garantit qu'une conversation tout juste
    // démarrée apparaisse
    // immédiatement sans attendre un rafraîchissement serveur.
    this.partenairesDmConnus = new Set();

    // Serveurs de l'utilisateur (dernier GET /api/servers) et index
    // salonId -> serveurId, pour router un message entrant vers son serveur
    // (pastille "non lu" du rail) et ouvrir le bon serveur depuis une
    // notification.
    this.serveurs = new Map();
    this.salonVersServeur = new Map();

    this.minuteurPollPresence = null;

    // Points d'injection pour les tests (voir RealGatewayRuntime.test.ts) :
    // par défaut, persistance réelle sur disque (voir plus haut).
    this.chargerJetonPersiste =
      options.chargerJetonPersiste ?? chargerJetonPersiste;
    this.sauvegarderJetonPersiste =
      options.sauvegarderJetonPersiste ?? sauvegarderJetonPersiste;
    this.creerSocket = options.creerSocket ?? io;
  }

  // --- Abonnement aux événements temps réel ---

  on(type, ecouteur) {
    const liste = this.ecouteurs.get(type) ?? [];
    liste.push(ecouteur);
    this.ecouteurs.set(type, liste);
    return () => {
      const courants = this.ecouteurs.get(type) ?? [];
      this.ecouteurs.set(
        type,
        courants.filter((item) => item !== ecouteur)
      );
    };
  }

  emettre(type, donnees) {
    for (const ecouteur of this.ecouteurs.get(type) ?? []) {
      ecouteur(donnees);
    }
  }

  // --- Infrastructure HTTP ---------------------------------------------------

  /**
   * Appel HTTP JSON générique vers le Gateway. Normalise toute erreur
   * (Gateway injoignable, réponse HTTP en erreur) vers un `Error` avec un
   * code stable ("ERR_*"/"ERR_HTTP_<statut>"), jamais un texte déjà traduit —
   * la traduction se fait à la frontière présentation. Le corps d'erreur réel
   * du backend est `{ erreur: "texte" }` (jamais `{ code }`) : ce texte reste
   * disponible sur `erreur.detail` pour un affichage plus précis si utile,
   * mais le message de l'Error (utilisé pour le routage/traduction) reste le
   * code HTTP stable.
   */
  async appelHttp(chemin, { methode = 'GET', corps } = {}) {
    let reponse;
    try {
      reponse = await fetch(`${this.baseUrlHttp}${chemin}`, {
        method: methode,
        headers: {
          'Content-Type': 'application/json',
          ...(this.jeton ? { Authorization: `Bearer ${this.jeton}` } : {}),
        },
        body: corps !== undefined ? JSON.stringify(corps) : undefined,
      });
    } catch {
      throw new Error('ERR_RESEAU_INDISPONIBLE');
    }
    if (!reponse.ok) {
      // Session ouverte et requête refusée : le jeton a peut-être expiré ou
      // été révoqué (voir verifierSessionApres401). Pas pour la connexion /
      // l'inscription elles-mêmes, ni pendant une reprise de session.
      if (
        reponse.status === 401 &&
        this.utilisateurConnecte &&
        !CHEMINS_SANS_SESSION.includes(chemin)
      ) {
        void this.verifierSessionApres401();
      }
      const corpsErreur = await reponse.json().catch(() => null);
      const erreur = new Error(`ERR_HTTP_${reponse.status}`);
      erreur.statut = reponse.status;
      erreur.detail = corpsErreur?.erreur;
      throw erreur;
    }
    if (reponse.status === 204) return undefined;
    return reponse.json();
  }

  definirEtatConnexion(statut, { cause, prochaineTentative } = {}) {
    this.etatConnexion = {
      statut,
      // `depuis` ne bouge que si le statut change (ex. plusieurs tentatives
      // de reconnexion successives gardent le même "depuis").
      depuis:
        this.etatConnexion?.statut === statut
          ? this.etatConnexion.depuis
          : Date.now(),
      reconnexions: this.reconnexions,
      cause: statut === 'connecte' ? undefined : cause,
      prochaineTentative,
    };
    this.emettre('etat-connexion', this.etatConnexion);
    return { ...this.etatConnexion };
  }

  obtenirEtatConnexion() {
    return { ...this.etatConnexion };
  }

  verifierReseauConnecte() {
    if (this.etatConnexion.statut !== 'connecte') {
      throw new Error('ERR_RESEAU_NON_CONNECTE');
    }
  }
}

// Méthodes par domaine, dans runtime/ (un fichier par section).
Object.assign(
  RealGatewayRuntime.prototype,
  require('./runtime/utilisateurs'),
  require('./runtime/session'),
  require('./runtime/configuration'),
  require('./runtime/temps-reel'),
  require('./runtime/serveurs'),
  require('./runtime/messages'),
  require('./runtime/presence'),
  require('./runtime/reseau')
);

module.exports = {
  RealGatewayRuntime,
  creerDmId,
  chargerJetonPersiste,
  sauvegarderJetonPersiste,
};
