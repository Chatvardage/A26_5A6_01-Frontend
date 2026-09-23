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
const NOM_FICHIER_SESSION = 'session.json';

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

function chargerJetonPersiste() {
  try {
    const contenu = fs.readFileSync(cheminFichierSession(), 'utf8');
    const donnees = JSON.parse(contenu);
    return typeof donnees.jeton === 'string' && donnees.jeton ? donnees.jeton : null;
  } catch {
    return null;
  }
}

function sauvegarderJetonPersiste(jeton) {
  try {
    if (jeton) {
      fs.writeFileSync(cheminFichierSession(), JSON.stringify({ jeton }), 'utf8');
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
 * Conserve délibérément la même forme d'API que l'ancien MockGatewayRuntime
 * (mêmes noms de méthodes, mêmes formes de retour pour les DTO salon/DM) afin
 * de minimiser les changements côté renderer.js/message-prive.js — voir
 * chaque méthode ci-dessous pour le détail de ce qui a changé ou non.
 *
 * Simplification majeure par rapport au mock : il n'y a plus de sélecteur
 * "utilisateur courant" côté UI (le mock permettait de simuler plusieurs
 * identités sans mot de passe — impossible avec un vrai compte/JWT). Les
 * paramètres `utilisateurId`/`hoteId` encore acceptés par certaines méthodes
 * ci-dessous, pour compatibilité avec les appels existants du renderer, sont
 * IGNORÉS : l'acteur réel est toujours l'utilisateur authentifié
 * (`this.utilisateurConnecte`), déduit du jeton JWT côté serveur.
 *
 * Lacune backend connue et assumée (voir Architecture.md) : aucun service
 * n'expose la présence d'un AUTRE utilisateur (seul `PUT
 * /api/config-utilisateur/presence` existe, pour SOI-MÊME). La présence des
 * autres utilisateurs reste donc affichée "hors-ligne" par défaut tant que ce
 * n'est pas ajouté côté backend.
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

    // Cache local des états de saisie reçus par Socket.IO (voir traiterSaisieEntrante).
    this.etatsSaisie = [];

    // Présences connues (voir obtenirPresences/definirPresenceInterne) — la
    // présence des AUTRES utilisateurs n'est jamais rafraîchie activement
    // (lacune backend, voir le commentaire de classe ci-dessus), seule la
    // nôtre (via User-Config-Service) est fiable.
    this.presences = {};

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

    // Ids de salons déjà rejoints (join HTTP + Socket.IO room) durant cette
    // session, pour éviter de rejoindre en double (voir assurerAdhesionSalon
    // / rejoindreSocketSalon).
    this.salonsRejoints = new Set();
    this.roomsSocketRejointes = new Set();

    // Partenaires de conversation privée connus localement cette session,
    // en complément de GET /api/messages/conversations (voir
    // obtenirConversationsPrivees) : sert de repli si cet endpoint échoue, et
    // garantit qu'une conversation tout juste démarrée apparaisse
    // immédiatement sans attendre un rafraîchissement serveur.
    this.partenairesDmConnus = new Set();

    this.minuteurPollPresence = null;

    // Points d'injection pour les tests (voir RealGatewayRuntime.test.ts) :
    // par défaut, persistance réelle sur disque (voir plus haut).
    this.chargerJetonPersiste =
      options.chargerJetonPersiste ?? chargerJetonPersiste;
    this.sauvegarderJetonPersiste =
      options.sauvegarderJetonPersiste ?? sauvegarderJetonPersiste;
    this.creerSocket = options.creerSocket ?? io;
  }

  // --- Abonnement aux événements temps réel (même API que l'ancien MockGatewayRuntime) ---

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
      const corpsErreur = await reponse.json().catch(() => null);
      const erreur = new Error(`ERR_HTTP_${reponse.status}`);
      erreur.statut = reponse.status;
      erreur.detail = corpsErreur?.erreur;
      throw erreur;
    }
    if (reponse.status === 204) return undefined;
    return reponse.json();
  }

  definirEtatConnexion(statut) {
    this.etatConnexion = {
      statut,
      depuis: Date.now(),
      reconnexions: this.reconnexions,
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
   * resoudrePseudos). Contrairement au mock, ce n'est PAS un répertoire
   * global : aucun endpoint de ce type n'existe côté backend pour un
   * utilisateur non-admin.
   */
  obtenirUtilisateurs() {
    return [...this.utilisateursConnus.values()].map((item) => ({ ...item }));
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
    const inconnus = [...new Set(ids)].filter(
      (id) => id && !this.utilisateursConnus.has(id)
    );
    if (!inconnus.length) return;
    try {
      const resultats = await this.appelHttp(
        `/api/users/lookup?ids=${inconnus.map(encodeURIComponent).join(',')}`
      );
      for (const item of resultats ?? []) {
        this.enregistrerUtilisateurConnu(item);
      }
    } catch {
      // Résolution best-effort : voir docstring.
    }
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
    this.connecterSocket();
    this.demarrerPollPresence();
    const etatConnexion = this.definirEtatConnexion('connecte');
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
   */
  async inscrire({ courriel, motDePasse, pseudo }) {
    const TENTATIVES_MAX = 4;
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
    } catch {
      this.jeton = null;
      this.sauvegarderJetonPersiste(null);
      return null;
    }
  }

  async deconnexion() {
    this.fermetureVoulue = true;
    this.arreterPollPresence();
    this.socket?.disconnect();
    this.socket = null;
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
    this.indexMessages.clear();
    this.salonsRejoints.clear();
    this.roomsSocketRejointes.clear();
    this.partenairesDmConnus.clear();
    this.etatsSaisie = [];
    this.definirEtatConnexion('deconnecte');
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
    return utilisateur;
  }

  /**
   * Change le courriel et/ou le mot de passe — le mot de passe ACTUEL est
   * obligatoire ici (vérifié par le serveur), pour empêcher qu'un jeton volé
   * ne permette une prise de contrôle permanente du compte.
   */
  async profilModifierCompte({ courriel, motDePasse, motDePasseActuel }) {
    const corps = { mot_de_passe_actuel: motDePasseActuel };
    if (courriel !== undefined) corps.courriel = courriel;
    if (motDePasse !== undefined) corps.mot_de_passe = motDePasse;
    const brut = await this.appelHttp('/api/auth/me', {
      methode: 'PATCH',
      corps,
    });
    const utilisateur = this.mapperUtilisateur(brut);
    this.utilisateurConnecte = utilisateur;
    this.enregistrerUtilisateurConnu(utilisateur);
    return utilisateur;
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
    };
  }

  async configObtenir() {
    const brut = await this.appelHttp('/api/config-utilisateur');
    return this.mapperConfig(brut);
  }

  async configModifier({ alias, theme, langue, modeNotification }) {
    const corps = {};
    if (alias !== undefined) corps.alias = alias;
    if (theme !== undefined) corps.theme = theme;
    if (langue !== undefined) corps.langue = langue;
    if (modeNotification !== undefined) corps.modeNotification = modeNotification;
    const brut = await this.appelHttp('/api/config-utilisateur', {
      methode: 'PATCH',
      corps,
    });
    return this.mapperConfig(brut);
  }

  // --- WebSocket (Socket.IO) : événements temps réel ---------------------------

  connecterSocket() {
    this.socket?.disconnect();
    const socket = this.creerSocket(`${this.baseUrlSocket}/messages`, {
      auth: { token: this.jeton },
      reconnection: false, // backoff géré nous-même, voir plus bas (même logique qu'avant)
      transports: ['websocket'],
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
      this.definirEtatConnexion('connecte');
      // Rejoint à nouveau les rooms Socket.IO des salons déjà connus (une
      // reconnexion Socket.IO démarre une session serveur neuve).
      this.roomsSocketRejointes.clear();
      for (const salonId of this.salonsRejoints) {
        this.rejoindreSocketSalon(salonId);
      }
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

    socket.on('disconnect', () => {
      if (this.fermetureVoulue) return;
      this.definirEtatConnexion('reconnexion');
      const delai = this.delaiReconnexionActuelMs;
      this.delaiReconnexionActuelMs = Math.min(
        this.delaiReconnexionActuelMs * 2,
        DELAI_RECONNEXION_MAX_MS
      );
      setTimeout(() => {
        if (this.fermetureVoulue) return;
        this.reconnexions += 1;
        this.connecterSocket();
      }, delai);
    });

    socket.on('connect_error', () => {
      // Suivi par 'disconnect' dans la plupart des cas : la reconnexion s'y
      // fait, pas ici — évite de dupliquer la logique de backoff.
    });
  }

  rejoindreSocketSalon(salonId) {
    if (!this.socket || this.roomsSocketRejointes.has(salonId)) return;
    this.socket.emit('room-message.join', { roomId: salonId });
    this.roomsSocketRejointes.add(salonId);
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

  /**
   * Convertit un `RoomResponse` (Room-Service) vers le DTO salon utilisé côté
   * UI. Le champ hôte/propriétaire (`hoteId` dans l'ancien contrat) est
   * remplacé par `creeParId` — purement informationnel, aucune autorisation
   * n'en dépend plus (voir Salon.ts domaine) : la gestion d'un salon est
   * réservée aux modérateurs/admins (rôle global), pas à son créateur.
   * Plusieurs noms de champ source sont tolérés par prudence (le contrat
   * exact du backend a pu varier pendant le développement parallèle).
   */
  mapperSalon(brut) {
    return {
      type: 'salon',
      id: brut.id,
      nom: brut.nom,
      visibilite: brut.visibilite,
      creeParId:
        brut.creePar ?? brut.createdBy ?? brut.creeParId ?? brut.hoteId,
      membreIds: brut.membreIds ?? [],
      membresInvites: brut.membresInvites ?? [],
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

  async assurerAdhesionSalon(salonId) {
    if (this.salonsRejoints.has(salonId)) return;
    try {
      await this.appelHttp(`/api/rooms/${encodeURIComponent(salonId)}/join`, {
        methode: 'POST',
      });
    } catch {
      // Déjà membre, ou salon privé sans invitation : on laisse l'appel
      // suivant (envoi de message) remonter l'erreur réelle le cas échéant,
      // plutôt que de bloquer ici sur une erreur qui n'en est pas toujours
      // une (cas "déjà membre").
    }
    this.salonsRejoints.add(salonId);
    this.rejoindreSocketSalon(salonId);
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

  async hydraterSalonAvecMessages(brutSalon) {
    const salon = this.mapperSalon(brutSalon);
    try {
      const { messages, finHistorique } = await this.obtenirMessagesSalonAvant({
        salonId: salon.id,
      });
      return { ...salon, messages, finHistorique };
    } catch {
      return { ...salon, messages: [], finHistorique: true };
    }
  }

  async obtenirEtat() {
    const [salonsBruts, invitationsBrutes] = await Promise.all([
      this.appelHttp('/api/rooms'),
      this.appelHttp('/api/rooms/invitations/me'),
    ]);
    const salons = await Promise.all(
      salonsBruts.map((brut) => this.hydraterSalonAvecMessages(brut))
    );
    // Ne marque "déjà rejoint" (skip du HTTP join dans assurerAdhesionSalon)
    // que les salons dont on est RÉELLEMENT déjà membre — `GET /api/rooms`
    // liste aussi les salons publics pas encore rejoints (visibles mais pas
    // membre), qu'il ne faut pas confondre avec une adhésion réelle sous
    // peine d'échec silencieux à l'envoi du premier message (pas de HTTP
    // join tenté).
    const moi = this.utilisateurConnecte?.id;
    for (const salon of salons) {
      if (moi && salon.membreIds.includes(moi)) {
        this.assurerAdhesionSocketSeulement(salon.id);
      }
    }

    const idsAResoudre = new Set();
    for (const salon of salons) {
      if (salon.creeParId) idsAResoudre.add(salon.creeParId);
      for (const id of salon.membreIds ?? []) idsAResoudre.add(id);
    }
    await this.resoudrePseudos([...idsAResoudre]);

    return {
      utilisateurs: this.obtenirUtilisateurs(),
      salons,
      invitations: invitationsBrutes.map((brut) => this.mapperSalon(brut)),
    };
  }

  /** Rejoint la room Socket.IO d'un salon dont on est déjà membre, sans appeler le HTTP `join` (déjà membre). */
  assurerAdhesionSocketSeulement(salonId) {
    this.salonsRejoints.add(salonId);
    this.rejoindreSocketSalon(salonId);
  }

  async creerSalon({ nom, prive }) {
    const brut = await this.appelHttp('/api/rooms', {
      methode: 'POST',
      corps: { nom, visibilite: prive ? 'prive' : 'public' },
    });
    this.assurerAdhesionSocketSeulement(brut.id);
    return this.hydraterSalonAvecMessages(brut);
  }

  async modifierSalon({ salonId, nom, visibilite }) {
    const corps = {};
    if (nom !== undefined) corps.nom = nom;
    if (visibilite !== undefined) corps.visibilite = visibilite;
    const brut = await this.appelHttp(`/api/rooms/${encodeURIComponent(salonId)}`, {
      methode: 'PATCH',
      corps,
    });
    return this.mapperSalon(brut);
  }

  async supprimerSalon(salonId) {
    await this.appelHttp(`/api/rooms/${encodeURIComponent(salonId)}`, {
      methode: 'DELETE',
    });
    this.salonsRejoints.delete(salonId);
    this.roomsSocketRejointes.delete(salonId);
    return { salonId };
  }

  async quitterSalonDistant(salonId) {
    await this.appelHttp(`/api/rooms/${encodeURIComponent(salonId)}/leave`, {
      methode: 'POST',
    });
    this.salonsRejoints.delete(salonId);
    this.roomsSocketRejointes.delete(salonId);
    if (this.socket) this.socket.emit('room-message.leave', { roomId: salonId });
    return { salonId };
  }

  async retirerMembreSalon({ salonId, utilisateurId }) {
    const brut = await this.appelHttp(
      `/api/rooms/${encodeURIComponent(salonId)}/members/${encodeURIComponent(utilisateurId)}`,
      { methode: 'DELETE' }
    );
    return this.mapperSalon(brut);
  }

  async inviter({ salonId, utilisateurId }) {
    const brut = await this.appelHttp(
      `/api/rooms/${encodeURIComponent(salonId)}/invitations`,
      { methode: 'POST', corps: { utilisateurId } }
    );
    return this.mapperSalon(brut);
  }

  async accepterInvitation({ salonId }) {
    const brut = await this.appelHttp(
      `/api/rooms/${encodeURIComponent(salonId)}/invitations/accept`,
      { methode: 'POST' }
    );
    this.assurerAdhesionSocketSeulement(brut.id);
    return this.hydraterSalonAvecMessages(brut);
  }

  async refuserInvitation({ salonId }) {
    await this.appelHttp(
      `/api/rooms/${encodeURIComponent(salonId)}/invitations/refuse`,
      { methode: 'POST' }
    );
    return { salonId };
  }

  // --- Messages de salon (HTTP, voir Message-Service) --------------------------

  async envoyerMessage({ salonId, contenu }) {
    this.verifierReseauConnecte();
    await this.assurerAdhesionSalon(salonId);
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
    return this.definirPresenceInterne({
      utilisateurId: this.utilisateurConnecte.id,
      statut,
    });
  }

  /**
   * Voir le commentaire de classe : la présence des AUTRES utilisateurs n'est
   * pas exposée par le backend — seule la nôtre (rafraîchie régulièrement,
   * voir demarrerPollPresence) est fiable. Les autres utilisateurs connus
   * s'affichent "hors-ligne" par défaut plutôt que de mentir sur un statut
   * qu'on ne connaît pas réellement.
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

  demarrerPollPresence() {
    this.arreterPollPresence();
    const rafraichir = async () => {
      if (!this.utilisateurConnecte) return;
      try {
        const config = await this.appelHttp('/api/config-utilisateur');
        this.definirPresenceInterne({
          utilisateurId: this.utilisateurConnecte.id,
          statut: config.statutPresence === 'enLigne' ? 'en-ligne' : 'hors-ligne',
        });
      } catch {
        // Best-effort : un échec de poll ne doit pas interrompre l'app.
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

  // --- Réseau (boutons "Coupure"/"Reconnexion") ---------------------------------
  // Ne sont plus des simulations : "Coupure" ferme volontairement le socket
  // Socket.IO, "Reconnexion" le rouvre — comportement réel, backoff
  // exponentiel existant conservé pour les coupures involontaires.

  simulerCoupure() {
    this.fermetureVoulue = true;
    this.socket?.disconnect();
    return this.definirEtatConnexion('deconnecte');
  }

  async simulerReconnexion() {
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    this.fermetureVoulue = false;
    this.connecterSocket();
    return this.obtenirEtatConnexion();
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
