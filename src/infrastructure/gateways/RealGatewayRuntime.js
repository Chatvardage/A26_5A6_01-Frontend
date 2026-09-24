'use strict';

const path = require('path');
const fs = require('fs');
const { io } = require('socket.io-client');
const { obtenirConfiguration } = require('../config/ConfigurationApi.js');

/**
 * Même schéma d'ID de conversation privée que creerDmId() dans
 * ConversationPrivee.ts — dupliqué ici pour la même raison (fichier CommonJS
 * exécuté sans étape de compilation, voir le commentaire d'en-tête plus bas).
 */
function creerDmId(utilisateurAId, utilisateurBId) {
  return [utilisateurAId, utilisateurBId].sort().join(':');
}

const DELAI_RECONNEXION_INITIAL_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;
const TAILLE_PAGE_MESSAGES = 15;
const INTERVALLE_POLL_PRESENCE_MS = 20000;
// Limite serveur de GET /api/config-utilisateur/publiques.
const NOMBRE_MAX_IDS_PUBLICS = 100;
// Limite serveur de GET /api/users/lookup (Authentification, LOOKUP_MAX_IDS) :
// au-delà, la requête entière est refusée (400).
const NOMBRE_MAX_IDS_LOOKUP = 100;
// Un « hors ligne » reçu en temps réel (socket fermé, voir Message-Service)
// prime sur le sondage pendant ce délai : User-Config-Service ne constate
// l'absence qu'après ~90 s sans signe de vie (voir `actif`).
const DUREE_PRIORITE_HORS_LIGNE_MS = 100_000;
const INTERVALLE_BATTEMENT_COEUR_MS = 15000;
// Repli si Message-Service n'envoie jamais 'connexion.prete' (version plus
// ancienne, déployée séparément) : passé ce délai après 'connect', le socket
// est considéré comme prêt — l'authentification côté serveur (un appel à
// Auth-Service, 3 s max) est alors forcément terminée.
const DELAI_REPLI_CONNEXION_PRETE_MS = 5000;
// Délai d'accusé de réception de 'room-message.join' (Message-Service
// vérifie l'accès auprès de Room-Service, ROOM_SERVICE_TIMEOUT_MS = 3 s).
const DELAI_ACK_REJOINDRE_SALON_MS = 8000;
const DELAI_BATTEMENT_COEUR_MS = 5000;
// Cause d'un état non connecté (voir EtatConnexion.ts) : affichée à
// l'utilisateur pour distinguer "ta machine n'a pas de réseau" de "le
// serveur ne répond pas".
const CAUSE_HORS_LIGNE = 'hors-ligne';
const CAUSE_SERVEUR_INJOIGNABLE = 'serveur-injoignable';
const NOM_FICHIER_SESSION = 'session.json';
// Appels qui ne supposent pas de session ouverte : un 401 y veut dire
// « identifiants invalides », jamais « session expirée ».
const CHEMINS_SANS_SESSION = ['/api/auth/login', '/api/auth/register'];

/**
 * Chemin du petit fichier JSON persistant le jeton de session (voir
 * `chargerJetonPersiste`/`sauvegarderJetonPersiste`), dans le dossier de
 * données utilisateur d'Electron (`app.getPath('userData')`). Le require()
 * d'`electron` est fait ici, au moment de l'appel, plutôt qu'en haut de
 * fichier : `app.getPath` n'est fiable qu'une fois Electron initialisé, et ce
 * module peut être chargé tôt (voir main.js).
 */
function cheminFichierSession() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), NOM_FICHIER_SESSION);
}

/**
 * Chiffrement du jeton par le système (`safeStorage` d'Electron : trousseau
 * Windows/macOS, libsecret/KWallet sous Linux), ou `null` s'il n'est pas
 * disponible. Sous Linux sans trousseau, Electron se rabat sur une clé fixe
 * ('basic_text') : c'est alors de l'obscurcissement, pas une vraie protection.
 */
function coffreJeton() {
  const { safeStorage } = require('electron');
  return safeStorage?.isEncryptionAvailable?.() ? safeStorage : null;
}

/**
 * Relit le jeton persisté. Format courant : `{ jetonChiffre }` (base64 du
 * jeton chiffré par coffreJeton). Ancien format `{ jeton }` en clair : relu,
 * puis réécrit chiffré si possible (migration sans reconnexion). Tout échec
 * (fichier absent ou illisible, déchiffrement impossible — trousseau changé,
 * autre machine…) renvoie `null` : l'utilisateur se reconnecte simplement.
 */
function chargerJetonPersiste() {
  try {
    const contenu = fs.readFileSync(cheminFichierSession(), 'utf8');
    const donnees = JSON.parse(contenu);
    if (typeof donnees.jetonChiffre === 'string' && donnees.jetonChiffre) {
      const coffre = coffreJeton();
      if (!coffre) return null;
      const jeton = coffre.decryptString(Buffer.from(donnees.jetonChiffre, 'base64'));
      return jeton || null;
    }
    if (typeof donnees.jeton === 'string' && donnees.jeton) {
      if (coffreJeton()) sauvegarderJetonPersiste(donnees.jeton);
      return donnees.jeton;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persiste le jeton de session (ou l'efface si `jeton` est vide). Chiffré par
 * le système quand c'est possible ; sinon, en clair (repli) — dans les deux
 * cas dans un fichier lisible par son seul propriétaire (0600).
 */
function sauvegarderJetonPersiste(jeton) {
  try {
    if (jeton) {
      const coffre = coffreJeton();
      const donnees = coffre
        ? { jetonChiffre: coffre.encryptString(jeton).toString('base64') }
        : { jeton };
      const chemin = cheminFichierSession();
      fs.writeFileSync(chemin, JSON.stringify(donnees), {
        encoding: 'utf8',
        mode: 0o600,
      });
      // `mode` ne s'applique qu'à la création : un ancien fichier garderait
      // ses droits d'origine.
      fs.chmodSync(chemin, 0o600);
    } else {
      fs.rmSync(cheminFichierSession(), { force: true });
    }
  } catch (erreur) {
    console.error(
      '[RealGatewayRuntime] persistance de session impossible :',
      erreur
    );
  }
}

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
    // Utilisateurs en ligne selon Message-Service : instantané reçu à la
    // connexion du socket ('presence.snapshot'), tenu à jour par les
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
    // obtenirConversationsPrivees) : sert de repli si cet endpoint échoue, et
    // garantit qu'une conversation tout juste démarrée apparaisse
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

  // --- Utilisateurs connus (voir commentaire de classe) -----------------------

  enregistrerUtilisateurConnu(utilisateur) {
    if (!utilisateur || !utilisateur.id) return;
    const existant = this.utilisateursConnus.get(utilisateur.id) ?? {};
    this.utilisateursConnus.set(utilisateur.id, {
      id: utilisateur.id,
      pseudo: utilisateur.pseudo ?? existant.pseudo ?? utilisateur.id,
      role: utilisateur.role ?? existant.role,
    });
  }

  /**
   * Retourne les utilisateurs "connus" localement (soi-même, participants de
   * DM déjà ouverts, résultats de résolution de pseudo — voir
   * resoudrePseudos). Ce n'est PAS un répertoire
   * global : aucun endpoint de ce type n'existe côté backend pour un
   * utilisateur non-admin.
   */
  obtenirUtilisateurs() {
    return [...this.utilisateursConnus.values()].map((item) => ({
      ...item,
      alias: this.profilsPublics.get(item.id)?.alias ?? null,
      avatar: this.profilsPublics.get(item.id)?.avatar ?? null,
    }));
  }

  /**
   * Résout les pseudos d'une liste d'ids inconnus localement via
   * `GET /api/users/lookup` (voir Authentification, endpoint public
   * authentifié dédié à l'affichage — jamais de courriel/rôle exposés par
   * cette route). Best-effort : une erreur réseau ne fait pas planter
   * l'appelant, les ids restent simplement non résolus (affichés en repli par
   * l'UI).
   */
  async resoudrePseudos(ids) {
    const uniques = [...new Set(ids)].filter(Boolean);
    const inconnus = uniques.filter((id) => !this.utilisateursConnus.has(id));
    // Profils publics (avatar, présence) jamais chargés : en parallèle de la
    // résolution des pseudos, pour que la première vue affiche déjà les photos.
    const sansProfil = uniques.filter(
      (id) =>
        id !== this.utilisateurConnecte?.id && !this.profilsPublics.has(id)
    );
    await Promise.all([
      inconnus.length ? this.resoudrePseudosInconnus(inconnus) : null,
      sansProfil.length ? this.chargerProfilsPublics(sansProfil) : null,
    ]);
  }

  async resoudrePseudosInconnus(inconnus) {
    // Par lots (voir NOMBRE_MAX_IDS_LOOKUP), en parallèle : un lot en erreur
    // n'empêche pas de résoudre les autres.
    const lots = [];
    for (let i = 0; i < inconnus.length; i += NOMBRE_MAX_IDS_LOOKUP) {
      lots.push(inconnus.slice(i, i + NOMBRE_MAX_IDS_LOOKUP));
    }
    await Promise.all(
      lots.map(async (lot) => {
        try {
          const resultats = await this.appelHttp(
            `/api/users/lookup?ids=${lot.map(encodeURIComponent).join(',')}`
          );
          for (const item of resultats ?? []) {
            this.enregistrerUtilisateurConnu(item);
          }
        } catch {
          // Résolution best-effort : voir docstring.
        }
      })
    );
  }

  /**
   * Charge alias/avatar/présence d'autres utilisateurs
   * (`GET /api/config-utilisateur/publiques`, 100 ids par requête). Émet
   * 'presence' pour chaque présence qui change, et 'profils-publics' si un
   * avatar ou un alias a changé (pour que l'UI redessine). Best-effort.
   */
  async chargerProfilsPublics(ids, { inclureAvatar = true } = {}) {
    const cibles = [...new Set(ids)].filter(
      (id) => id && id !== this.utilisateurConnecte?.id
    );
    const profilsModifies = [];
    for (let i = 0; i < cibles.length; i += NOMBRE_MAX_IDS_PUBLICS) {
      const lot = cibles.slice(i, i + NOMBRE_MAX_IDS_PUBLICS);
      let resultats;
      try {
        resultats = await this.appelHttp(
          `/api/config-utilisateur/publiques?ids=${lot.map(encodeURIComponent).join(',')}` +
            (inclureAvatar ? '' : '&inclureAvatar=false')
        );
      } catch {
        continue;
      }
      const parId = new Map((resultats ?? []).map((p) => [p.idUtilisateur, p]));
      for (const id of lot) {
        // Absent de la réponse = aucune configuration : hors ligne, sans photo.
        const profil = parId.get(id);
        const precedent = this.profilsPublics.get(id);
        const suivant = {
          alias: profil?.alias ?? null,
          avatar: inclureAvatar
            ? (profil?.avatar ?? null)
            : (precedent?.avatar ?? null),
        };
        if (
          precedent &&
          (precedent.alias !== suivant.alias || precedent.avatar !== suivant.avatar)
        ) {
          profilsModifies.push(id);
        }
        this.profilsPublics.set(id, suivant);
        const horsLigneRecent =
          Date.now() - (this.horsLigneTempsReel.get(id) ?? 0) <
          DUREE_PRIORITE_HORS_LIGNE_MS;
        // Hors ligne selon User-Config-Service : fait toujours foi. En ligne :
        // confirmé par le temps réel s'il est disponible (voir
        // enLigneTempsReel), sinon sauf « hors ligne » tout récent.
        const confirmeEnLigne = this.enLigneTempsReel
          ? this.enLigneTempsReel.has(id)
          : !horsLigneRecent;
        const statut =
          profil?.actif && confirmeEnLigne ? 'en-ligne' : 'hors-ligne';
        if (this.presences[id] !== statut) {
          this.definirPresenceInterne({ utilisateurId: id, statut });
        }
      }
    }
    if (profilsModifies.length) this.emettre('profils-publics', profilsModifies);
  }

  /**
   * Candidats "Nouveau message privé" : description d'affichage (nom,
   * alias, avatar, présence) d'une liste d'ids déjà résolus, sans
   * soi-même, triée par nom affiché.
   */
  decrireUtilisateurs(ids) {
    const moi = this.utilisateurConnecte?.id;
    return [...new Set(ids)]
      .filter((id) => id !== moi && this.utilisateursConnus.has(id))
      .map((id) => ({
        id,
        pseudo: this.utilisateursConnus.get(id).pseudo,
        alias: this.profilsPublics.get(id)?.alias ?? null,
        avatar: this.profilsPublics.get(id)?.avatar ?? null,
        present: this.presences[id] === 'en-ligne',
      }))
      .sort((a, b) =>
        (a.alias || a.pseudo).localeCompare(b.alias || b.pseudo, undefined, {
          sensitivity: 'base',
        })
      );
  }

  /**
   * Suggestions de personnes à qui écrire, sans rien taper : membres de
   * tous ses serveurs (`GET /api/servers`, sans charger les messages) et
   * interlocuteurs de DM déjà connus. Ne dépend donc plus
   * d'une visite préalable de la page des salons.
   */
  async obtenirSuggestionsDm() {
    const ids = new Set(this.partenairesDmConnus);
    try {
      const serveurs = await this.chargerServeurs();
      for (const serveur of serveurs) {
        for (const membre of serveur.membres) ids.add(membre.utilisateurId);
      }
    } catch {
      // Best-effort : on garde au moins les interlocuteurs connus.
    }
    await this.resoudrePseudos([...ids]);
    return this.decrireUtilisateurs([...ids]);
  }

  /**
   * Recherche par début de pseudo (`GET /api/users/search`, Authentification)
   * pour écrire à quelqu'un avec qui on ne partage aucun salon.
   */
  async rechercherUtilisateurs(texte) {
    const q = String(texte ?? '').trim().slice(0, 20);
    if (!q) return [];
    const resultats = await this.appelHttp(
      `/api/users/search?q=${encodeURIComponent(q)}&limit=20`
    );
    for (const item of resultats ?? []) this.enregistrerUtilisateurConnu(item);
    const ids = (resultats ?? []).map((item) => item.id);
    await this.resoudrePseudos(ids);
    return this.decrireUtilisateurs(ids);
  }

  /** Notre propre alias/avatar, pour obtenirUtilisateurs() (messages que
   * l'on a soi-même envoyés, liste des membres). */
  memoriserProfilSoi(config) {
    if (!this.utilisateurConnecte) return;
    this.profilsPublics.set(this.utilisateurConnecte.id, {
      alias: config.alias ?? null,
      avatar: config.avatar ?? null,
    });
  }


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
  }

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
  }

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
  }

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
    let derniereErreur;
    for (let tentative = 0; tentative < TENTATIVES_MAX; tentative += 1) {
      try {
        const reponse = await this.appelHttp('/api/auth/register', {
          methode: 'POST',
          corps: { pseudo: pseudoTente, courriel, mot_de_passe: motDePasse },
        });
        return this.ouvrirSession(reponse);
      } catch (erreur) {
        derniereErreur = erreur;
        if (erreur.statut !== 409) throw erreur;
        const suffixe = String(Math.floor(1000 + Math.random() * 9000));
        pseudoTente = `${pseudo}`.slice(0, 20 - suffixe.length) + suffixe;
      }
    }
    throw derniereErreur;
  }

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
      if (erreur?.statut === 401 || erreur?.statut === 403 || erreur?.statut === 404) {
        this.sauvegarderJetonPersiste(null);
      }
      return null;
    }
  }

  async deconnexion() {
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
  }

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
    if (this.verificationSessionEnCours) return;
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
  }

  /** Utilisateur authentifié courant, ou `null` si personne n'est connecté. */
  obtenirUtilisateurConnecte() {
    return this.utilisateurConnecte ? { ...this.utilisateurConnecte } : null;
  }

  // --- Profil (page "Modifier le profil") -------------------------------------

  async profilObtenir() {
    const brut = await this.appelHttp('/api/auth/me');
    const utilisateur = this.mapperUtilisateur(brut);
    this.utilisateurConnecte = utilisateur;
    this.enregistrerUtilisateurConnu(utilisateur);
    return utilisateur;
  }

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
  }

  /**
   * Change le mot de passe (le courriel n'est pas modifiable) — le mot de passe ACTUEL est
   * obligatoire ici (vérifié par le serveur), pour empêcher qu'un jeton volé
   * ne permette une prise de contrôle permanente du compte.
   */
  async profilModifierCompte({ motDePasse, motDePasseActuel }) {
    // Pas de courriel : Authentification refuse de le modifier via /me.
    const corps = { mot_de_passe_actuel: motDePasseActuel };
    if (motDePasse !== undefined) corps.mot_de_passe = motDePasse;
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
  }

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
  }

  async profilSupprimerCompte(motDePasseActuel) {
    await this.appelHttp('/api/auth/me', {
      methode: 'DELETE',
      corps: { mot_de_passe_actuel: motDePasseActuel },
    });
    await this.deconnexion();
  }

  // --- Configuration utilisateur (alias, thème, langue, notifications) --------

  mapperConfig(brut) {
    return {
      alias: brut.alias ?? null,
      theme: brut.theme,
      langue: brut.langue,
      statutPresence: brut.statutPresence === 'enLigne' ? 'en-ligne' : 'hors-ligne',
      vuLaDerniereFois: brut.vuLaDerniereFois ?? null,
      modeNotification: brut.modeNotification,
      avatar: brut.avatar ?? null,
    };
  }

  async configObtenir() {
    const config = this.mapperConfig(
      await this.appelHttp('/api/config-utilisateur')
    );
    this.memoriserProfilSoi(config);
    return config;
  }

  async configModifier({ alias, theme, langue, modeNotification, avatar }) {
    const corps = {};
    // Chaîne vide = retirer l'avatar (même convention que l'alias).
    if (avatar !== undefined) corps.avatar = avatar ?? '';
    if (alias !== undefined) corps.alias = alias;
    if (theme !== undefined) corps.theme = theme;
    if (langue !== undefined) corps.langue = langue;
    if (modeNotification !== undefined) corps.modeNotification = modeNotification;
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
  }

  /** Signale aux autres clients que notre profil public a changé. */
  annoncerProfil() {
    if (this.socketPret && this.socket?.connected) {
      this.socket.emit('profil.update');
    }
  }

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
  }

  traiterProfilEntrant(evt) {
    const id = evt?.userId;
    if (typeof id !== 'string' || id === this.utilisateurConnecte?.id) return;
    // Uniquement les utilisateurs qu'on affiche déjà quelque part.
    if (!this.utilisateursConnus.has(id) && !this.profilsPublics.has(id)) return;
    void this.rafraichirProfil(id);
  }

  /**
   * Changement dans un de nos serveurs, signalé par Room-Service via
   * Message-Service : relayé aux pages ('serveur-change'), qui rechargent.
   */
  traiterServeurEntrant(evt) {
    if (typeof evt?.serveurId !== 'string' || typeof evt.raison !== 'string') {
      return;
    }
    this.emettre('serveur-change', {
      serveurId: evt.serveurId,
      raison: evt.raison,
      cibleId: typeof evt.cibleId === 'string' ? evt.cibleId : null,
    });
  }

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
      // Les autres clients ont pu nous voir « hors ligne » pendant la coupure.
      this.annoncerPresence();
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

    socket.on('private-message.created', (m) => this.traiterMessageDmEntrant(m));
    socket.on('private-message.updated', (m) => this.traiterMessageDmModifie(m));
    socket.on('private-message.deleted', (m) =>
      this.traiterMessageDmSupprime(m)
    );
    socket.on('room-message.created', (m) => this.traiterMessageSalonEntrant(m));
    socket.on('room-message.updated', (m) => this.traiterMessageSalonModifie(m));
    socket.on('room-message.deleted', (m) =>
      this.traiterMessageSalonSupprime(m)
    );
    socket.on('typing', (evt) => this.traiterSaisieEntrante(evt));
    // Présence en temps réel (voir Message-Service, 'presence.changed').
    socket.on('presence.changed', (evt) => this.traiterPresenceEntrante(evt));
    socket.on('presence.snapshot', (evt) => this.traiterInstantanePresence(evt));
    socket.on('profil.changed', (evt) => this.traiterProfilEntrant(evt));
    socket.on('serveur.change', (evt) => this.traiterServeurEntrant(evt));
    // Accès à un salon perdu (expulsion, salon réservé…) : Message-Service a
    // retiré ce socket de la room. On l'oublie pour pouvoir la rejoindre de
    // nouveau si l'accès revient (voir rejoindreSocketSalon).
    socket.on('room-message.revoked', (evt) => {
      if (typeof evt?.roomId === 'string') {
        this.roomsSocketRejointes.delete(evt.roomId);
      }
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
  }

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
  }

  traiterMessageDmEntrant(brut) {
    const message = this.mapperMessageDm(brut);
    this.indexMessages.set(message.id, { type: 'dm' });
    this.partenairesDmConnus.add(this.autreParticipantDm(message.conversationId));
    this.emettre('message-recu', { conversationType: 'dm', message });
  }

  traiterMessageDmModifie(brut) {
    const message = this.mapperMessageDm(brut);
    this.indexMessages.set(message.id, { type: 'dm' });
    this.emettre('message-modifie', message);
  }

  traiterMessageDmSupprime(brut) {
    this.indexMessages.delete(brut.id);
    this.emettre('message-supprime', { messageId: brut.id });
  }

  traiterMessageSalonEntrant(brut) {
    const message = this.mapperMessageSalon(brut);
    this.indexMessages.set(message.id, { type: 'salon', roomId: brut.roomId });
    this.emettre('message-recu', {
      conversationType: 'salon',
      salonId: brut.roomId,
      serveurId: this.salonVersServeur.get(brut.roomId) ?? null,
      message,
    });
  }

  traiterMessageSalonModifie(brut) {
    const message = this.mapperMessageSalon(brut);
    this.indexMessages.set(message.id, { type: 'salon', roomId: brut.roomId });
    this.emettre('message-modifie', message);
  }

  traiterMessageSalonSupprime(brut) {
    this.indexMessages.delete(brut.id);
    this.emettre('message-supprime', { messageId: brut.id });
  }

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
  }

  // --- Salons (HTTP, voir Room-Service) ----------------------------------------

  // --- Serveurs et salons (Room-Service, façon Discord) ----------------------

  /**
   * Salon d'un serveur, dans la forme attendue par renderer.js. `membreIds`
   * = membres du serveur qui voient ce salon (liste des membres, invitation) ;
   * `visibilite: 'prive'` pour un salon réservé aux modérateurs (affiché
   * avec un cadenas).
   */
  mapperSalon(brut, serveur) {
    const reserve = brut.acces === 'moderateurs';
    const membres = serveur?.membres ?? [];
    return {
      type: 'salon',
      id: brut.id,
      serveurId: brut.serveurId,
      nom: brut.nom,
      position: brut.position,
      acces: brut.acces,
      ecriture: brut.ecriture,
      peutEcrire: brut.peutEcrire,
      visibilite: reserve ? 'prive' : 'public',
      creeParId: brut.creePar ?? null,
      membreIds: membres
        .filter((membre) => !reserve || membre.role !== 'membre')
        .map((membre) => membre.utilisateurId),
      membresInvites: serveur?.invitations ?? [],
    };
  }

  mapperMessageSalon(brut) {
    const cree = new Date(brut.createdAt).getTime();
    const modifie = new Date(brut.updatedAt).getTime();
    return {
      id: brut.id,
      auteurId: brut.authorId,
      contenu: brut.content,
      date: cree,
      ...(modifie !== cree ? { modification: modifie } : {}),
    };
  }

  resumeServeur(serveur) {
    return {
      id: serveur.id,
      nom: serveur.nom,
      icone: serveur.icone ?? null,
      public: serveur.public,
      parDefaut: serveur.parDefaut,
      monRole: serveur.monRole,
      nombreMembres: serveur.nombreMembres,
      salonIds: serveur.salons.map((salon) => salon.id),
    };
  }

  /** GET /api/servers, mémorisé (voir `this.serveurs`). */
  async chargerServeurs() {
    const serveurs = await this.appelHttp('/api/servers');
    this.serveurs.clear();
    this.salonVersServeur.clear();
    for (const serveur of serveurs) {
      this.serveurs.set(serveur.id, serveur);
      for (const salon of serveur.salons) {
        this.salonVersServeur.set(salon.id, serveur.id);
      }
    }
    return serveurs;
  }

  /** Liste légère des serveurs (rail de la page messages privés). */
  async obtenirServeurs() {
    const serveurs = await this.chargerServeurs();
    return serveurs.map((serveur) => this.resumeServeur(serveur));
  }

  async obtenirMessagesSalonAvant({ salonId, avantId, taille }) {
    const limite = taille || TAILLE_PAGE_MESSAGES;
    const params = new URLSearchParams({ limit: String(limite) });
    if (avantId) params.set('cursor', avantId);
    const bruts = await this.appelHttp(
      `/api/messages/rooms/${encodeURIComponent(salonId)}/history?${params.toString()}`
    );
    const messages = bruts.map((m) => this.mapperMessageSalon(m));
    messages.forEach((m) =>
      this.indexMessages.set(m.id, { type: 'salon', roomId: salonId })
    );
    return { messages, finHistorique: bruts.length < limite };
  }

  async hydraterSalonAvecMessages(salon) {
    try {
      const { messages, finHistorique } = await this.obtenirMessagesSalonAvant({
        salonId: salon.id,
      });
      return { ...salon, messages, finHistorique };
    } catch {
      return { ...salon, messages: [], finHistorique: true };
    }
  }

  /**
   * État de la page des salons : mes serveurs (rail), le serveur actif avec
   * ses salons (et leurs derniers messages) et mes invitations.
   * Serveur actif : celui qui contient `salonId` s'il est fourni (ouverture
   * depuis une notification), sinon `serveurId`, sinon le premier
   * (Chatvardage).
   */
  async obtenirEtat({ serveurId, salonId } = {}) {
    const [serveurs, invitationsBrutes] = await Promise.all([
      this.chargerServeurs(),
      this.appelHttp('/api/servers/invitations/me'),
    ]);
    const actifId =
      (salonId && this.salonVersServeur.get(salonId)) ||
      (serveurId && this.serveurs.has(serveurId) ? serveurId : null) ||
      serveurs[0]?.id;
    const actif = this.serveurs.get(actifId) ?? null;

    // Rooms Socket.IO de TOUS les salons visibles de tous mes serveurs : les
    // messages des autres serveurs allument leur pastille "non lu" du rail.
    for (const serveur of serveurs) {
      for (const salon of serveur.salons) {
        this.assurerAdhesionSocketSeulement(salon.id);
      }
    }

    const salons = actif
      ? await Promise.all(
          actif.salons.map((brut) =>
            this.hydraterSalonAvecMessages(this.mapperSalon(brut, actif))
          )
        )
      : [];

    await this.resoudrePseudos([
      ...(actif?.membres ?? []).map((membre) => membre.utilisateurId),
      ...invitationsBrutes.map((invitation) => invitation.invitePar),
    ]);

    return {
      utilisateurs: this.obtenirUtilisateurs(),
      serveurs: serveurs.map((serveur) => this.resumeServeur(serveur)),
      serveurActif: actif
        ? {
            ...this.resumeServeur(actif),
            proprietaireId: actif.proprietaireId,
            membres: actif.membres,
            invitations: actif.invitations,
          }
        : null,
      salons,
      invitations: invitationsBrutes.map((invitation) => ({
        id: invitation.serveur.id,
        nom: invitation.serveur.nom,
        public: invitation.serveur.public,
        nombreMembres: invitation.serveur.nombreMembres,
        invitePar: invitation.invitePar,
      })),
    };
  }

  /** Rejoint la room Socket.IO d'un salon (l'appartenance est au serveur). */
  assurerAdhesionSocketSeulement(salonId) {
    this.salonsRejoints.add(salonId);
    this.rejoindreSocketSalon(salonId);
  }

  // Serveurs ----------------------------------------------------------------

  async creerServeur({ nom, public: estPublic }) {
    return this.appelHttp('/api/servers', {
      methode: 'POST',
      corps: { nom, public: Boolean(estPublic) },
    });
  }

  async modifierServeur({ serveurId, nom, public: estPublic, icone }) {
    const corps = {};
    if (nom !== undefined) corps.nom = nom;
    if (estPublic !== undefined) corps.public = estPublic;
    if (icone !== undefined) corps.icone = icone ?? '';
    return this.appelHttp(`/api/servers/${encodeURIComponent(serveurId)}`, {
      methode: 'PATCH',
      corps,
    });
  }

  async supprimerServeur(serveurId) {
    await this.appelHttp(`/api/servers/${encodeURIComponent(serveurId)}`, {
      methode: 'DELETE',
    });
    return { serveurId };
  }

  async rejoindreServeur(serveurId) {
    return this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/join`,
      { methode: 'POST' }
    );
  }

  async quitterServeur(serveurId) {
    await this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/leave`,
      { methode: 'POST' }
    );
    return { serveurId };
  }

  /** Serveurs publics dont je ne suis pas membre (recherche par nom). */
  async decouvrirServeurs(texte) {
    const q = String(texte ?? '').trim().slice(0, 80);
    return this.appelHttp(
      `/api/servers/decouvrir${q ? `?q=${encodeURIComponent(q)}` : ''}`
    );
  }

  async expulserMembre({ serveurId, utilisateurId }) {
    return this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/members/${encodeURIComponent(utilisateurId)}`,
      { methode: 'DELETE' }
    );
  }

  async changerRoleMembre({ serveurId, utilisateurId, role }) {
    return this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/members/${encodeURIComponent(utilisateurId)}`,
      { methode: 'PATCH', corps: { role } }
    );
  }

  async inviter({ serveurId, utilisateurId }) {
    return this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/invitations`,
      { methode: 'POST', corps: { utilisateurId } }
    );
  }

  async accepterInvitation({ serveurId }) {
    return this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/invitations/accept`,
      { methode: 'POST' }
    );
  }

  async refuserInvitation({ serveurId }) {
    await this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/invitations/refuse`,
      { methode: 'POST' }
    );
    return { serveurId };
  }

  // Salons ------------------------------------------------------------------

  async creerSalon({ serveurId, nom, acces, ecriture }) {
    const brut = await this.appelHttp(
      `/api/servers/${encodeURIComponent(serveurId)}/channels`,
      { methode: 'POST', corps: { nom, acces, ecriture } }
    );
    this.salonVersServeur.set(brut.id, serveurId);
    this.assurerAdhesionSocketSeulement(brut.id);
    return this.mapperSalon(brut, this.serveurs.get(serveurId));
  }

  async modifierSalon({ salonId, nom, acces, ecriture }) {
    const corps = {};
    if (nom !== undefined) corps.nom = nom;
    if (acces !== undefined) corps.acces = acces;
    if (ecriture !== undefined) corps.ecriture = ecriture;
    const brut = await this.appelHttp(
      `/api/channels/${encodeURIComponent(salonId)}`,
      { methode: 'PATCH', corps }
    );
    return this.mapperSalon(brut, this.serveurs.get(brut.serveurId));
  }

  async supprimerSalon(salonId) {
    await this.appelHttp(`/api/channels/${encodeURIComponent(salonId)}`, {
      methode: 'DELETE',
    });
    this.salonsRejoints.delete(salonId);
    this.roomsSocketRejointes.delete(salonId);
    this.salonVersServeur.delete(salonId);
    return { salonId };
  }

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
  }

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
  }

  autreParticipantDm(conversationId) {
    const [a, b] = String(conversationId).split(':');
    const moi = this.utilisateurConnecte?.id;
    return a === moi ? b : a;
  }

  async obtenirMessagesPriveesAvantParUtilisateur(autreUtilisateurId, { avantId, taille } = {}) {
    const limite = taille || TAILLE_PAGE_MESSAGES;
    const params = new URLSearchParams({ limit: String(limite) });
    if (avantId) params.set('cursor', avantId);
    const bruts = await this.appelHttp(
      `/api/messages/history/${encodeURIComponent(autreUtilisateurId)}?${params.toString()}`
    );
    const messages = bruts.map((m) => this.mapperMessageDm(m));
    messages.forEach((m) => this.indexMessages.set(m.id, { type: 'dm' }));
    return { messages, finHistorique: bruts.length < limite };
  }

  async obtenirMessagesPriveesAvant({ conversationId, avantId, taille }) {
    return this.obtenirMessagesPriveesAvantParUtilisateur(
      this.autreParticipantDm(conversationId),
      { avantId, taille }
    );
  }

  async construireConversationPrivee(autreUtilisateurId, dernierMessageConnu) {
    try {
      const { messages, finHistorique } =
        await this.obtenirMessagesPriveesAvantParUtilisateur(autreUtilisateurId);
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
  }

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
      .sort((a, b) => (b.lastMessage?.envoi ?? 0) - (a.lastMessage?.envoi ?? 0));
  }

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
  }

  async demarrerConversationPrivee({ autreUtilisateurId }) {
    this.partenairesDmConnus.add(autreUtilisateurId);
    return this.construireConversationPrivee(autreUtilisateurId);
  }

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
  }

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
  }

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
  }

  // --- Présence -----------------------------------------------------------------

  definirPresenceInterne({ utilisateurId, statut }) {
    this.presences[utilisateurId] = statut;
    const presence = { utilisateurId, statut, vuLaDerniereFois: Date.now() };
    this.emettre('presence', presence);
    return presence;
  }

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
  }

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
  }

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
  }

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
  }

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
  }

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
  }

  arreterPollPresence() {
    if (this.minuteurPollPresence) clearInterval(this.minuteurPollPresence);
    this.minuteurPollPresence = null;
  }

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
  }

  /** Ferme le socket courant SANS déclencher de reconnexion (voir le garde
   * `this.socket !== socket` dans les écouteurs de connecterSocket). */
  fermerSocket() {
    const socket = this.socket;
    this.socket = null;
    this.socketPret = false;
    clearTimeout(this.minuteurRepliConnexionPrete);
    // Plus de flux temps réel : l'instantané de présence n'est plus fiable.
    this.enLigneTempsReel = null;
    socket?.disconnect();
  }

  annulerReconnexionPlanifiee() {
    if (this.minuteurReconnexion) clearTimeout(this.minuteurReconnexion);
    this.minuteurReconnexion = null;
  }

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
      if (!this.sessionActive() || this.fermetureVoulue || this.horsLigneSysteme)
        return;
      this.reconnexions += 1;
      this.definirEtatConnexion('reconnexion', {
        cause: CAUSE_SERVEUR_INJOIGNABLE,
      });
      this.connecterSocket();
    }, delai);
  }

  /** Bouton "Réessayer maintenant" : saute le délai en cours et repart d'un
   * backoff minimal. Sans effet (hors état) si la machine est hors ligne. */
  reconnecterMaintenant() {
    if (!this.sessionActive()) return this.obtenirEtatConnexion();
    this.annulerReconnexionPlanifiee();
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    this.fermetureVoulue = false;
    if (this.horsLigneSysteme) {
      return this.definirEtatConnexion('deconnecte', { cause: CAUSE_HORS_LIGNE });
    }
    this.definirEtatConnexion('reconnexion', {
      cause: this.etatConnexion.cause ?? CAUSE_SERVEUR_INJOIGNABLE,
    });
    this.connecterSocket();
    return this.obtenirEtatConnexion();
  }

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
  }

  /** Sortie de veille : le socket d'avant la mise en veille est presque
   * toujours mort sans le savoir, on en ouvre un neuf immédiatement. */
  signalerReveil() {
    if (this.sessionActive() && !this.fermetureVoulue) {
      this.reconnecterMaintenant();
    }
  }

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
        if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      } catch {
        // Le socket a pu être remplacé pendant l'appel : n'agir que s'il
        // s'agit toujours du même.
        if (this.socket !== socket || this.etatConnexion.statut !== 'connecte')
          return;
        this.fermerSocket();
        this.planifierReconnexion();
      }
    }, INTERVALLE_BATTEMENT_COEUR_MS);
  }

  arreterBattementCoeur() {
    if (this.minuteurBattementCoeur) clearInterval(this.minuteurBattementCoeur);
    this.minuteurBattementCoeur = null;
  }

  fetchAvecDelai(url, delaiMs) {
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), delaiMs);
    return fetch(url, { signal: controleur.signal }).finally(() =>
      clearTimeout(minuteur)
    );
  }

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
    this.socket.emit('typing', { scope, targetId, isTyping: Boolean(est_saisie) });
    return {
      conversationId,
      utilisateurId: this.utilisateurConnecte?.id,
      est_saisie: Boolean(est_saisie),
    };
  }

  obtenirEtatsSaisie(param) {
    const id = typeof param === 'string' ? param : param?.conversationId;
    if (!id) return [];
    return this.etatsSaisie
      .filter((item) => item.conversationId === id)
      .map((item) => ({ ...item }));
  }
}

module.exports = { RealGatewayRuntime, creerDmId, chargerJetonPersiste, sauvegarderJetonPersiste };
