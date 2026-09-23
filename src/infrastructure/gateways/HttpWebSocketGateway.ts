import type {
  ChatGateway,
  Desabonner,
  OptionsPaginationMessages,
} from './ChatGateway.ts';
import type {
  AuthGateway,
  IdentifiantsConnexion,
  IdentifiantsInscription,
  ResultatAuthentification,
} from './AuthGateway.ts';
import type { ConversationId } from '../../domain/entities/Conversation.ts';
import type { Message } from '../../domain/entities/Message.ts';
import type { Salon, Visibilite } from '../../domain/entities/Salon.ts';
import type { ConversationPrivee } from '../../domain/entities/ConversationPrivee.ts';
import type { Presence } from '../../domain/entities/Presence.ts';
import type { EtatSaisie } from '../../domain/entities/EtatSaisie.ts';
import type { EtatConnexion, Etat } from '../../domain/entities/EtatConnexion.ts';
import type { Utilisateur } from '../../domain/entities/Utilisateur.ts';
import { creerEtatConnexion } from '../../domain/entities/EtatConnexion';

/**
 * HttpWebSocketGateway — implémentation de `ChatGateway` (et de
 * `AuthGateway`, voir AuthGateway.ts) prévue pour un usage web/navigateur
 * (WebSocket brut), suivant la même couche d'architecture "cible" décrite
 * dans Architecture.md.
 *
 * ⚠️ PAS LE CHEMIN RÉELLEMENT EXÉCUTÉ PAR L'APP ELECTRON : `main.tsx` (page
 * de connexion) appelle directement `window.electronAPI.*` (IPC), qui délègue
 * à `RealGatewayRuntime.js` côté process main — c'est CETTE classe-là qui
 * communique réellement avec le Gateway ChatVardage (Serveur-API, HTTP +
 * Socket.IO). Cette classe-ci (`HttpWebSocketGateway`) reste ici comme
 * implémentation de référence du contrat `ChatGateway`/`AuthGateway`
 * exploitable hors Electron (ex. un futur client web), mais son contrat
 * HTTP/WS peut diverger de celui réellement implémenté par le Gateway tant
 * qu'elle n'a pas été resynchronisée avec `RealGatewayRuntime.js` — se fier à
 * ce dernier comme source de vérité du contrat réel.
 */

/** Configuration minimale nécessaire pour joindre le Gateway ChatVardage. */
export interface ConfigurationHttpWebSocketGateway {
  /** Racine des endpoints REST du Gateway, ex. "http://localhost:3000". */
  readonly baseUrlHttp: string;
  /** Racine du endpoint WebSocket du Gateway, ex. "ws://localhost:3000". */
  readonly baseUrlWs: string;
}

/** Configuration par défaut : Gateway ChatVardage local (voir A26_5A6_01-Infra). */
export const CONFIGURATION_PAR_DEFAUT: ConfigurationHttpWebSocketGateway = {
  baseUrlHttp: 'http://localhost:3000',
  baseUrlWs: 'ws://localhost:3000',
};

/** Délai avant la première tentative de reconnexion WebSocket, doublé à chaque échec (backoff exponentiel), plafonné par DELAI_RECONNEXION_MAX_MS. */
const DELAI_RECONNEXION_INITIAL_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;

type EvenementTempsReel =
  | { type: 'message'; donnees: Message }
  | { type: 'presence'; donnees: Presence }
  | { type: 'saisie'; donnees: EtatSaisie }
  | { type: 'etat-connexion'; donnees: EtatConnexion }
  | { type: 'salon'; donnees: Salon };

export class HttpWebSocketGateway implements ChatGateway, AuthGateway {
  private readonly config: ConfigurationHttpWebSocketGateway;
  private jeton: string | null = null;
  private utilisateurCourant: Utilisateur | null = null;
  private etatConnexion: EtatConnexion = creerEtatConnexion('deconnecte');
  private reconnexions = 0;
  private socket: WebSocket | null = null;
  private delaiReconnexionActuelMs = DELAI_RECONNEXION_INITIAL_MS;
  private fermetureVoulue = false;

  private readonly ecouteursMessage = new Set<(message: Message) => void>();
  private readonly ecouteursPresence = new Set<(presence: Presence) => void>();
  private readonly ecouteursSaisie = new Set<(etat: EtatSaisie) => void>();
  private readonly ecouteursEtatConnexion = new Set<
    (etat: EtatConnexion) => void
  >();
  private readonly ecouteursSalon = new Set<(salon: Salon) => void>();

  constructor(
    config: ConfigurationHttpWebSocketGateway = CONFIGURATION_PAR_DEFAUT
  ) {
    this.config = config;
  }

  // --- Infrastructure HTTP -------------------------------------------------

  /**
   * Effectue un appel HTTP JSON vers le backend, avec le jeton de session
   * courant s'il y en a un. Normalise toute erreur (réseau, HTTP 4xx/5xx)
   * vers un `Error` dont le message est un code stable (voir la convention
   * "ERR_*" déjà utilisée par MockGatewayRuntime.js), jamais un texte déjà
   * traduit — la traduction se fait à la frontière présentation (voir
   * traduireErreurSoumission dans LoginPage.tsx).
   */
  private async requete<T>(
    chemin: string,
    options: { methode?: string; corps?: unknown } = {}
  ): Promise<T> {
    const { methode = 'GET', corps } = options;
    let reponse: Response;
    try {
      reponse = await fetch(`${this.config.baseUrlHttp}${chemin}`, {
        method: methode,
        headers: {
          'Content-Type': 'application/json',
          ...(this.jeton ? { Authorization: `Bearer ${this.jeton}` } : {}),
        },
        body: corps !== undefined ? JSON.stringify(corps) : undefined,
      });
    } catch {
      // Backend injoignable (URL fictive tant que le service réel n'existe
      // pas, ou coupure réseau) : code stable plutôt que l'erreur fetch brute.
      throw new Error('ERR_RESEAU_INDISPONIBLE');
    }

    if (!reponse.ok) {
      // Le backend est censé répondre avec { code: 'ERR_XXX' } sur les
      // erreurs métier (pseudo pris, identifiants invalides, etc.) ; on
      // retombe sur un code générique si le corps n'est pas exploitable.
      const corpsErreur = await reponse.json().catch(() => null);
      throw new Error(corpsErreur?.code ?? `ERR_HTTP_${reponse.status}`);
    }

    if (reponse.status === 204) return undefined as T;
    return (await reponse.json()) as T;
  }

  // --- Connexion / authentification (voir AuthGateway.ts) ------------------

  async authentifier(
    identifiants: IdentifiantsConnexion
  ): Promise<ResultatAuthentification> {
    const reponse = await this.requete<{
      utilisateur: Utilisateur;
      jeton: string;
    }>('/auth/connexion', { methode: 'POST', corps: identifiants });
    return this.ouvrirSession(reponse.utilisateur, reponse.jeton);
  }

  async inscrire(
    identifiants: IdentifiantsInscription
  ): Promise<ResultatAuthentification> {
    const reponse = await this.requete<{
      utilisateur: Utilisateur;
      jeton: string;
    }>('/auth/inscription', { methode: 'POST', corps: identifiants });
    return this.ouvrirSession(reponse.utilisateur, reponse.jeton);
  }

  /**
   * Établit la connexion au service de chat pour un utilisateur DÉJÀ
   * authentifié (voir la note de conception dans AuthGateway.ts sur pourquoi
   * cette méthode ne prend pas de mot de passe). Utile pour reprendre une
   * session existante (ex. jeton déjà en mémoire) sans repasser par
   * `authentifier`.
   */
  async connexion(utilisateur: Utilisateur): Promise<EtatConnexion> {
    const resultat = await this.ouvrirSession(utilisateur, this.jeton ?? '');
    return resultat.etatConnexion;
  }

  private async ouvrirSession(
    utilisateur: Utilisateur,
    jeton: string
  ): Promise<ResultatAuthentification> {
    this.jeton = jeton;
    this.utilisateurCourant = utilisateur;
    this.fermetureVoulue = false;
    this.connecterWebSocket();
    const etatConnexion = this.definirEtatConnexion('connecte');
    return { utilisateur, etatConnexion };
  }

  async deconnexion(): Promise<void> {
    this.fermetureVoulue = true;
    this.socket?.close();
    this.socket = null;
    this.jeton = null;
    this.utilisateurCourant = null;
    this.definirEtatConnexion('deconnecte');
  }

  obtenirEtatConnexion(): EtatConnexion {
    return this.etatConnexion;
  }

  private definirEtatConnexion(statut: Etat): EtatConnexion {
    this.etatConnexion = creerEtatConnexion(
      statut,
      Date.now(),
      this.reconnexions
    );
    for (const ecouteur of this.ecouteursEtatConnexion) {
      ecouteur(this.etatConnexion);
    }
    return this.etatConnexion;
  }

  // --- WebSocket (événements temps réel) ------------------------------------

  /**
   * Ouvre la connexion WebSocket authentifiée (jeton en paramètre de
   * requête — le backend choisira peut-être un en-tête à la place, à ajuster
   * une fois l'API réelle spécifiée) et démarre l'écoute des événements
   * poussés par le serveur. Se reconnecte automatiquement avec un
   * backoff exponentiel (voir DELAI_RECONNEXION_*) tant que la fermeture
   * n'est pas volontaire (voir `deconnexion`).
   */
  private connecterWebSocket(): void {
    this.socket?.close();
    const url = `${this.config.baseUrlWs}?jeton=${encodeURIComponent(this.jeton ?? '')}`;
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

    // Une erreur WebSocket est presque toujours suivie d'un 'close' : on
    // laisse ce dernier gérer la reconnexion plutôt que de dupliquer la
    // logique ici.
    socket.addEventListener('error', () => {});
  }

  private traiterMessageEntrant(donneesBrutes: unknown): void {
    let evenement: EvenementTempsReel;
    try {
      evenement =
        typeof donneesBrutes === 'string'
          ? JSON.parse(donneesBrutes)
          : donneesBrutes;
    } catch {
      return; // Trame illisible : ignorée plutôt que de faire planter le gateway.
    }

    switch (evenement.type) {
      case 'message':
        for (const ecouteur of this.ecouteursMessage) ecouteur(evenement.donnees);
        break;
      case 'presence':
        for (const ecouteur of this.ecouteursPresence) ecouteur(evenement.donnees);
        break;
      case 'saisie':
        for (const ecouteur of this.ecouteursSaisie) ecouteur(evenement.donnees);
        break;
      case 'etat-connexion':
        this.etatConnexion = evenement.donnees;
        for (const ecouteur of this.ecouteursEtatConnexion)
          ecouteur(evenement.donnees);
        break;
      case 'salon':
        for (const ecouteur of this.ecouteursSalon) ecouteur(evenement.donnees);
        break;
    }
  }

  lorsMessage(callback: (message: Message) => void): Desabonner {
    this.ecouteursMessage.add(callback);
    return () => this.ecouteursMessage.delete(callback);
  }

  onPresence(callback: (presence: Presence) => void): Desabonner {
    this.ecouteursPresence.add(callback);
    return () => this.ecouteursPresence.delete(callback);
  }

  onSaisie(callback: (etat: EtatSaisie) => void): Desabonner {
    this.ecouteursSaisie.add(callback);
    return () => this.ecouteursSaisie.delete(callback);
  }

  onEtatConnexion(callback: (etat: EtatConnexion) => void): Desabonner {
    this.ecouteursEtatConnexion.add(callback);
    return () => this.ecouteursEtatConnexion.delete(callback);
  }

  onSalon(callback: (salon: Salon) => void): Desabonner {
    this.ecouteursSalon.add(callback);
    return () => this.ecouteursSalon.delete(callback);
  }

  // --- Salons (HTTP) ---------------------------------------------------------

  async obtenirSalons(): Promise<Salon[]> {
    return this.requete<Salon[]>('/salons');
  }

  async creerSalon(nom: string, visibilite: Visibilite = 'public'): Promise<Salon> {
    return this.requete<Salon>('/salons', {
      methode: 'POST',
      corps: { nom, visibilite },
    });
  }

  async rejoindreSalon(salonId: ConversationId): Promise<Salon> {
    return this.requete<Salon>(
      `/salons/${encodeURIComponent(salonId)}/membres`,
      { methode: 'POST' }
    );
  }

  async inviterUtilisateurAuSalon(
    salonId: ConversationId,
    utilisateurId: string,
    hoteId: string
  ): Promise<Salon> {
    return this.requete<Salon>(
      `/salons/${encodeURIComponent(salonId)}/invitations`,
      { methode: 'POST', corps: { utilisateurId, hoteId } }
    );
  }

  async obtenirInvitationsUtilisateur(utilisateurId: string): Promise<Salon[]> {
    return this.requete<Salon[]>(
      `/utilisateurs/${encodeURIComponent(utilisateurId)}/invitations`
    );
  }

  async accepterInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.requete<Salon>(
      `/salons/${encodeURIComponent(salonId)}/invitations/${encodeURIComponent(utilisateurId)}/acceptation`,
      { methode: 'POST' }
    );
  }

  async refuserInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.requete<Salon>(
      `/salons/${encodeURIComponent(salonId)}/invitations/${encodeURIComponent(utilisateurId)}`,
      { methode: 'DELETE' }
    );
  }

  // --- Messages (HTTP) --------------------------------------------------------

  async envoyerMessage(
    conversationId: ConversationId,
    contenu: string
  ): Promise<Message> {
    return this.requete<Message>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      { methode: 'POST', corps: { contenu } }
    );
  }

  async obtenirMessages(
    conversationId: ConversationId,
    options: OptionsPaginationMessages = {}
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (options.avantId) params.set('avantId', options.avantId);
    if (options.taillePage) params.set('taille', String(options.taillePage));
    const suffixe = params.toString() ? `?${params.toString()}` : '';
    return this.requete<Message[]>(
      `/conversations/${encodeURIComponent(conversationId)}/messages${suffixe}`
    );
  }

  // --- Messages privés (HTTP) --------------------------------------------------

  async ouvrirConversationPrivee(
    autreUtilisateurId: string
  ): Promise<ConversationPrivee> {
    return this.requete<ConversationPrivee>('/conversations-privees', {
      methode: 'POST',
      corps: { autreUtilisateurId },
    });
  }

  // --- Présence / saisie (WebSocket, transport léger et éphémère) -------------

  /**
   * Envoyé directement sur le WebSocket plutôt qu'en HTTP : l'état de
   * saisie est éphémère et n'a pas besoin d'être persisté ni confirmé par
   * une réponse — un simple message "fire and forget", cohérent avec sa
   * nature temps réel (voir DELAI_EXPIRATION_MS dans le domaine EtatSaisie).
   */
  async fixerSaisie(
    conversationId: ConversationId,
    enTrainDEcrire: boolean
  ): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('ERR_RESEAU_NON_CONNECTE');
    }
    this.socket.send(
      JSON.stringify({ type: 'saisie', conversationId, enTrainDEcrire })
    );
  }
}
