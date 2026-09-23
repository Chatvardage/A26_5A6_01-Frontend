'use strict';

const { obtenirConfiguration } = require('../config/ConfigurationApi.js');

/**
 * Même schéma d'ID de conversation privée que creerDmId() dans
 * MockGatewayRuntime.js / ConversationPrivee.ts — dupliqué ici pour la même
 * raison (fichier CommonJS exécuté sans étape de compilation, voir le
 * commentaire d'en-tête de MockGatewayRuntime.js).
 */
function creerDmId(utilisateurAId, utilisateurBId) {
  return [utilisateurAId, utilisateurBId].sort().join(':');
}

const DELAI_RECONNEXION_INITIAL_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

/**
 * RealGatewayRuntime — implémentation RÉELLE du contrat utilisé par main.js
 * (mêmes méthodes que MockGatewayRuntime.js, voir son en-tête pour la liste
 * de référence), qui communique avec le backend par HTTP (requêtes/réponses)
 * et WebSocket (événements temps réel : présence, messages modifiés/
 * supprimés, changements d'état réseau).
 *
 * ÉTAT ACTUEL (voir ConfigurationApi.js) : l'URL du backend est FICTIVE tant
 * que celui-ci (et sa base de données) n'est pas terminé. Le code est écrit
 * pour être prêt dès qu'il le sera ; en attendant, chaque appel réseau
 * échoue normalement (voir `appelHttp`), ce que main.js gère déjà (les
 * canaux IPC rejettent, l'UI affiche une erreur au lieu de planter — voir
 * aussi la simulation de messages de démo dans main.js, déjà protégée par
 * un try/catch).
 *
 * Pour revenir au mock pendant le développement sans backend disponible :
 * variable d'environnement CHATVARDAGE_BACKEND=mock (voir main.js).
 */
class RealGatewayRuntime {
  constructor(config = obtenirConfiguration()) {
    this.baseUrlHttp = config.baseUrlHttp;
    this.baseUrlWs = config.baseUrlWs;

    this.jeton = null;
    this.utilisateurConnecteId = null;
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

    // Cache local des états de saisie reçus par WebSocket (voir
    // modifierEtatSaisie/obtenirEtatsSaisie) : contrairement au mock, il n'y
    // a pas de "source de vérité" HTTP pour ces états éphémères — seul le
    // dernier événement WS reçu par conversation compte.
    this.etatsSaisie = [];
  }

  // --- Abonnement aux événements temps réel (même API que MockGatewayRuntime) ---

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
   * Appel HTTP JSON générique. Normalise toute erreur (backend injoignable,
   * réponse HTTP en erreur) vers un `Error` avec un code stable ("ERR_*"),
   * jamais un texte déjà traduit — voir nettoyerPrefixeIpc dans main.tsx qui
   * ne fait que retirer le préfixe IPC d'Electron, sans traduire.
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
      throw new Error(corpsErreur?.code ?? `ERR_HTTP_${reponse.status}`);
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

  // --- WebSocket ---------------------------------------------------------------

  connecterWebSocket() {
    this.socket?.close();
    const url = `${this.baseUrlWs}?jeton=${encodeURIComponent(this.jeton ?? '')}`;

    // Node 22+/Electron récent expose `WebSocket` globalement (comme
    // `fetch`) — pas de dépendance npm supplémentaire (ex. `ws`) nécessaire.
    if (typeof WebSocket === 'undefined') {
      console.error(
        '[RealGatewayRuntime] WebSocket global indisponible dans ce runtime Node/Electron.'
      );
      return;
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
      this.definirEtatConnexion('connecte');
    });

    socket.addEventListener('message', (evenement) => {
      this.traiterMessageEntrant(evenement.data);
    });

    socket.addEventListener('close', () => {
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
        this.connecterWebSocket();
      }, delai);
    });

    socket.addEventListener('error', () => {
      // Suivi par un 'close' : la reconnexion s'y fait, pas ici.
    });
  }

  traiterMessageEntrant(donneesBrutes) {
    let evenement;
    try {
      evenement =
        typeof donneesBrutes === 'string'
          ? JSON.parse(donneesBrutes)
          : donneesBrutes;
    } catch {
      return;
    }

    switch (evenement?.type) {
      case 'presence':
        this.emettre('presence', evenement.donnees);
        break;
      case 'message-modifie':
        this.emettre('message-modifie', evenement.donnees);
        break;
      case 'message-supprime':
        this.emettre('message-supprime', evenement.donnees);
        break;
      case 'etat-connexion':
        this.etatConnexion = evenement.donnees;
        this.emettre('etat-connexion', evenement.donnees);
        break;
      case 'saisie': {
        const etat = evenement.donnees;
        const index = this.etatsSaisie.findIndex(
          (item) =>
            item.conversationId === etat.conversationId &&
            item.utilisateurId === etat.utilisateurId
        );
        if (index !== -1) this.etatsSaisie[index] = etat;
        else this.etatsSaisie.push(etat);
        break;
      }
      default:
        break;
    }
  }

  // --- Session (écran de connexion / inscription) -----------------------------

  async pseudoDisponible(pseudo) {
    const { disponible } = await this.appelHttp(
      `/auth/pseudo-disponible?pseudo=${encodeURIComponent(pseudo)}`
    );
    return disponible;
  }

  /**
   * Authentifie un utilisateur par pseudo OU courriel + mot de passe (voir
   * "identifiant" côté LoginPage.tsx). Contrairement à l'ancien flux du mock
   * (connexion({id, pseudo}) sans mot de passe), c'est le backend qui crée
   * l'ID et retourne le jeton de session.
   */
  async authentifier({ identifiant, motDePasse }) {
    const reponse = await this.appelHttp('/auth/connexion', {
      methode: 'POST',
      corps: { identifiant, motDePasse },
    });
    return this.ouvrirSession(reponse);
  }

  /**
   * Inscrit un nouvel utilisateur (courriel + mot de passe seulement, pas de
   * pseudo — voir genererPseudoParDefaut côté domaine/InscriptionPage.tsx,
   * qui envoie tout de même un pseudo par défaut au backend pour respecter
   * l'API décrite ici ; le backend reste libre de l'ajuster pour garantir
   * l'unicité).
   */
  async inscrire({ courriel, motDePasse, pseudo }) {
    const reponse = await this.appelHttp('/auth/inscription', {
      methode: 'POST',
      corps: { courriel, motDePasse, pseudo },
    });
    return this.ouvrirSession(reponse);
  }

  ouvrirSession({ utilisateur, jeton }) {
    this.jeton = jeton;
    this.utilisateurConnecteId = utilisateur.id;
    this.fermetureVoulue = false;
    this.connecterWebSocket();
    const etatConnexion = this.definirEtatConnexion('connecte');
    return { utilisateur, etatConnexion };
  }

  /**
   * Conservé pour compatibilité avec le canal IPC historique
   * 'session:connexion' (voir main.js) : reprend une session déjà
   * authentifiée (ex. après authentifier()) plutôt que d'en ouvrir une
   * nouvelle avec des identifiants.
   */
  connexion() {
    return this.definirEtatConnexion('connecte');
  }

  async deconnexion() {
    this.fermetureVoulue = true;
    this.socket?.close();
    this.socket = null;
    this.jeton = null;
    this.utilisateurConnecteId = null;
    this.definirEtatConnexion('deconnecte');
  }

  obtenirUtilisateurConnecte() {
    return this.utilisateurConnecteId ?? null;
  }

  /** Ferme volontairement le WebSocket : équivalent réel de "simuler une coupure" pour tester la reprise (voir MockGatewayRuntime.simulerCoupure). */
  simulerCoupure() {
    this.socket?.close();
    return this.definirEtatConnexion('deconnecte');
  }

  /** Force une tentative de reconnexion immédiate plutôt que d'attendre le backoff en cours. */
  async simulerReconnexion() {
    this.delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
    this.connecterWebSocket();
    return this.obtenirEtatConnexion();
  }

  // --- Présence ----------------------------------------------------------------

  async obtenirPresences() {
    return this.appelHttp('/presence');
  }

  async modifierPresence({ utilisateurId, statut }) {
    this.verifierReseauConnecte();
    return this.appelHttp('/presence', {
      methode: 'POST',
      corps: { utilisateurId, statut },
    });
  }

  // --- Salons --------------------------------------------------------------------

  async obtenirUtilisateurs() {
    return this.appelHttp('/utilisateurs');
  }

  async obtenirEtat(utilisateurId) {
    return this.appelHttp(
      `/salons/etat?utilisateurId=${encodeURIComponent(utilisateurId)}`
    );
  }

  async obtenirMessagesSalonAvant({ salonId, utilisateurId, avantId, taille }) {
    const params = new URLSearchParams({ utilisateurId });
    if (avantId) params.set('avantId', avantId);
    if (taille) params.set('taille', String(taille));
    return this.appelHttp(
      `/salons/${encodeURIComponent(salonId)}/messages?${params.toString()}`
    );
  }

  async creerSalon({ nom, prive, utilisateurId }) {
    return this.appelHttp('/salons', {
      methode: 'POST',
      corps: { nom, prive, utilisateurId },
    });
  }

  async inviter({ salonId, utilisateurId, hoteId }) {
    return this.appelHttp(`/salons/${encodeURIComponent(salonId)}/invitations`, {
      methode: 'POST',
      corps: { utilisateurId, hoteId },
    });
  }

  async accepterInvitation({ salonId, utilisateurId }) {
    return this.appelHttp(
      `/salons/${encodeURIComponent(salonId)}/invitations/${encodeURIComponent(utilisateurId)}/acceptation`,
      { methode: 'POST' }
    );
  }

  async refuserInvitation({ salonId, utilisateurId }) {
    return this.appelHttp(
      `/salons/${encodeURIComponent(salonId)}/invitations/${encodeURIComponent(utilisateurId)}`,
      { methode: 'DELETE' }
    );
  }

  // --- Messages --------------------------------------------------------------------

  async envoyerMessage({ salonId, utilisateurId, contenu }) {
    this.verifierReseauConnecte();
    return this.appelHttp(`/salons/${encodeURIComponent(salonId)}/messages`, {
      methode: 'POST',
      corps: { utilisateurId, contenu },
    });
  }

  async modifierMessage({ messageId, utilisateurId, contenu }) {
    this.verifierReseauConnecte();
    return this.appelHttp(`/messages/${encodeURIComponent(messageId)}`, {
      methode: 'PATCH',
      corps: { utilisateurId, contenu },
    });
  }

  async supprimerMessage({ messageId, utilisateurId }) {
    this.verifierReseauConnecte();
    await this.appelHttp(`/messages/${encodeURIComponent(messageId)}`, {
      methode: 'DELETE',
      corps: { utilisateurId },
    });
    return { messageId };
  }

  // --- Messages privés (DM) -----------------------------------------------------

  async obtenirConversationsPrivees(utilisateurId) {
    return this.appelHttp(
      `/dm?utilisateurId=${encodeURIComponent(utilisateurId)}`
    );
  }

  async obtenirMessagesPriveesAvant({
    conversationId,
    utilisateurId,
    avantId,
    taille,
  }) {
    const params = new URLSearchParams({ utilisateurId });
    if (avantId) params.set('avantId', avantId);
    if (taille) params.set('taille', String(taille));
    return this.appelHttp(
      `/dm/${encodeURIComponent(conversationId)}/messages?${params.toString()}`
    );
  }

  async envoyerMessagePrive({ conversationId, contenu, utilisateurId }) {
    this.verifierReseauConnecte();
    return this.appelHttp(`/dm/${encodeURIComponent(conversationId)}/messages`, {
      methode: 'POST',
      corps: { utilisateurId, contenu },
    });
  }

  async demarrerConversationPrivee({ utilisateurId, autreUtilisateurId }) {
    return this.appelHttp('/dm', {
      methode: 'POST',
      corps: { utilisateurId, autreUtilisateurId },
    });
  }

  // --- État de saisie (WebSocket, éphémère — voir traiterMessageEntrant) --------

  async modifierEtatSaisie({ conversationId, utilisateurId, est_saisie }) {
    this.verifierReseauConnecte();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('ERR_RESEAU_NON_CONNECTE');
    }
    const etat = {
      conversationId,
      utilisateurId,
      est_saisie: Boolean(est_saisie),
    };
    this.socket.send(JSON.stringify({ type: 'saisie', donnees: etat }));
    return etat;
  }

  obtenirEtatsSaisie(param) {
    const id = typeof param === 'string' ? param : param?.conversationId;
    if (!id) return [];
    return this.etatsSaisie
      .filter((item) => item.conversationId === id)
      .map((item) => ({ ...item }));
  }
}

module.exports = { RealGatewayRuntime, creerDmId };
