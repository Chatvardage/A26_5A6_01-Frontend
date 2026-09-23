import type { ConversationId } from '../../domain/entities/Conversation.ts';
import type { Message } from '../../domain/entities/Message.ts';
import type { Salon, Visibilite } from '../../domain/entities/Salon.ts';
import type { ConversationPrivee } from '../../domain/entities/ConversationPrivee.ts';
import type { Presence } from '../../domain/entities/Presence.ts';
import type { EtatSaisie } from '../../domain/entities/EtatSaisie.ts';
import type { EtatConnexion } from '../../domain/entities/EtatConnexion.ts';
import type { Utilisateur } from '../../domain/entities/Utilisateur.ts';

/**
 * Fonction retournée par chaque méthode d'abonnement à un événement temps réel.
 * L'appeler retire l'écouteur correspondant (équivalent d'un "unsubscribe"),
 * de la même manière que `onPong` dans preload.js retourne déjà une fonction
 * de désabonnement pour `ipcRenderer.removeListener`.
 */
export type Desabonner = () => void;

/**
 * Options de pagination pour la récupération de l'historique des messages
 * d'une conversation (voir `paginerAvant` dans le domaine `Message`).
 */
export interface OptionsPaginationMessages {
  /** Ne retourne que les messages envoyés avant ce message (pagination "charger plus ancien"). */
  readonly avantId?: string;
  /** Nombre maximum de messages à retourner. */
  readonly taillePage?: number;
}

/**
 * ChatGateway — interface unique de communication avec le service de chat.
 *
 * C'est le seul point de contact entre la couche UI / logique applicative et le service de chat.
 * Aucun composant UI ne doit importer ou instancier directement une implémentation concrète
 * (ex. MockGateway) : il doit uniquement dépendre de ce type `ChatGateway`, obtenu par
 * injection (ex. passé en paramètre, fourni par un contexte/store).
 *
 * Pour cette itération, seule une implémentation simulée existe (MockGateway : salons, DM,
 * présence, "typing" et réseau simulés via timers/événements en mémoire, avec latence et
 * déconnexions paramétrables). Elle sera remplacée plus tard par une implémentation réseau réelle
 * (WebSocket/HTTP) sans qu'aucun composant UI n'ait à changer, puisqu'il ne connaît que ce contrat.
 */
export interface ChatGateway {
  // --- Connexion ----------------------------------------------------------

  /**
   * Établit la connexion au service de chat pour l'utilisateur donné (crée la session locale).
   * Une implémentation réseau ferait ici la poignée de main avec le serveur ; le mock simule un
   * délai et peut simuler un échec/une reconnexion.
   *
   * @param utilisateur L'utilisateur qui se connecte (pseudo déjà validé/choisi).
   * @returns L'état de connexion résultant (ex. `{ statut: 'connecte', ... }`).
   */
  connexion(utilisateur: Utilisateur): Promise<EtatConnexion>;

  /**
   * Ferme la connexion au service de chat et libère les abonnements actifs.
   *
   * @returns L'état de connexion résultant (ex. `{ statut: 'deconnecte', ... }`).
   */
  deconnexion(): Promise<void>;

  /**
   * Retourne l'état de connexion courant (connecté / déconnecté / reconnexion),
   * pour l'affichage immédiat sans attendre un événement `onEtatConnexion`.
   *
   * @returns L'état de connexion courant (ex. `{ statut: 'connecte', ... }`).
   */
  obtenirEtatConnexion(): EtatConnexion;

  // --- Salons ---------------------------------------------------------------

  /**
   * Retourne la liste des salons visibles par l'utilisateur courant
   * (salons publics, et salons privés dont il est déjà membre).
   *
   * @returns La liste des salons visibles par l'utilisateur courant.
   */
  obtenirSalons(): Promise<Salon[]>;

  /**
   * Crée un nouveau salon dont l'utilisateur courant devient l'hôte.
   *
   * @param nom Nom du salon à créer.
   * @param visibilite Visibilité du salon ('public' par défaut, ou 'prive').
   *
   * @returns Le salon créé, avec son identifiant unique.
   */
  creerSalon(nom: string, visibilite?: Visibilite): Promise<Salon>;

  /**
   * Fait rejoindre l'utilisateur courant à un salon existant.
   * Pour un salon privé, l'utilisateur doit avoir été invité au préalable (voir `onSalon`
   * pour être notifié d'une invitation reçue).
   *
   * @param salonId Identifiant du salon à rejoindre.
   * @throws Rejette la promesse si le salon n'existe pas, ou si le salon est privé et que
   * l'utilisateur n'y est pas invité.
   *
   * @returns Le salon rejoint, avec ses informations à jour (membres, messages, etc.).
   */
  rejoindreSalon(salonId: ConversationId): Promise<Salon>;

  /**
   * Invite localement un utilisateur dans un salon privé. Seul l'hôte du salon peut inviter.
   * Sans effet sur un salon public (les invitations n'y ont pas de sens, voir `rejoindreSalon`).
   *
   * @param salonId Identifiant du salon privé dans lequel inviter.
   * @param utilisateurId Identifiant de l'utilisateur à inviter.
   * @param hoteId Identifiant de l'hôte effectuant l'invitation.
   * @throws Rejette la promesse si le salon n'existe pas, si le salon est public, ou si
   * `hoteId` n'est pas l'hôte du salon.
   *
   * @returns Le salon mis à jour, avec l'invitation ajoutée.
   */
  inviterUtilisateurAuSalon(
    salonId: ConversationId,
    utilisateurId: string,
    hoteId: string
  ): Promise<Salon>;

  /**
   * Retourne la liste des salons privés pour lesquels l'utilisateur donné a une
   * invitation en attente (ni acceptée, ni refusée).
   *
   * @param utilisateurId Identifiant de l'utilisateur dont on veut les invitations en attente.
   *
   * @returns La liste des salons pour lesquels une invitation est en attente.
   */
  obtenirInvitationsUtilisateur(utilisateurId: string): Promise<Salon[]>;

  /**
   * Accepte une invitation en attente et ajoute l'utilisateur aux membres du salon.
   *
   * @param salonId Identifiant du salon privé dont l'invitation est acceptée.
   * @param utilisateurId Identifiant de l'utilisateur qui accepte l'invitation.
   * @throws Rejette la promesse si le salon n'existe pas, ou si aucune invitation n'est
   * en attente pour cet utilisateur sur ce salon.
   *
   * @returns Le salon mis à jour, avec l'utilisateur désormais membre.
   */
  accepterInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon>;

  /**
   * Refuse une invitation en attente, sans donner accès au salon.
   *
   * @param salonId Identifiant du salon privé dont l'invitation est refusée.
   * @param utilisateurId Identifiant de l'utilisateur qui refuse l'invitation.
   * @throws Rejette la promesse si le salon n'existe pas, ou si aucune invitation n'est
   * en attente pour cet utilisateur sur ce salon.
   *
   * @returns Le salon mis à jour, avec l'invitation retirée.
   */
  refuserInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon>;

  // --- Messages ---------------------------------------------------------------

  /**
   * Envoie un message texte dans une conversation (salon ou DM).
   * L'auteur est déduit de la session courante (voir `connect`) ; l'horodatage est
   * généré par le gateway.
   *
   * @param conversationId Identifiant de la conversation (salon ou DM) dans laquelle envoyer le message.
   * @param contenu Contenu texte du message à envoyer.
   *
   * @returns Le message envoyé, avec son identifiant unique et son horodatage.
   */
  envoyerMessage(
    conversationId: ConversationId,
    contenu: string
  ): Promise<Message>;

  /**
   * Récupère une page de l'historique des messages d'une conversation, du plus ancien
   * au plus récent (voir `OptionsPaginationMessages` pour la pagination "charger plus ancien").
   *
   * @param conversationId Identifiant de la conversation (salon ou DM) dont on veut l'historique.
   * @param options Options de pagination (voir `OptionsPaginationMessages`).
   *
   * @returns La liste des messages récupérés, triés du plus ancien au plus récent.
   */
  obtenirMessages(
    conversationId: ConversationId,
    options?: OptionsPaginationMessages
  ): Promise<Message[]>;

  // --- Messages privés (DM) ------------------------------------------------------

  /**
   * Ouvre la conversation privée avec un autre utilisateur, ou retourne celle déjà
   * existante entre les deux utilisateurs (voir `creerDmId`, symétrique aux deux participants).
   *
   * @param autreUtilisateurId Identifiant de l'autre utilisateur avec lequel ouvrir la conversation privée.
   *
   * @returns La conversation privée ouverte ou existante, avec ses informations à jour (membres, messages, etc.).
   */
  ouvrirConversationPrivee(
    autreUtilisateurId: string
  ): Promise<ConversationPrivee>;

  // --- Présence et indicateur de saisie ------------------------------------------

  /**
   * Signale que l'utilisateur courant est (ou n'est plus) en train d'écrire dans une
   * conversation. Le gateway se charge de faire expirer l'état côté abonnés (voir
   * `DELAI_EXPIRATION_MS` dans le domaine `EtatSaisie`) si aucune actualisation ne suit.
   *
   * @param conversationId Identifiant de la conversation (salon ou DM) dans laquelle l'utilisateur est en train d'écrire.
   * @param enTrainDEcrire `true` si l'utilisateur est en train d'écrire, `false` sinon.
   *
   * @returns Une promesse résolue lorsque l'état de saisie a été mis à jour côté serveur.
   */
  fixerSaisie(
    conversationId: ConversationId,
    enTrainDEcrire: boolean
  ): Promise<void>;

  // --- Événements temps réel ----------------------------------------------------
  // Un canal nommé par événement métier (jamais de `on(nomEvenement, cb)` générique),
  // même principe que les canaux IPC fixes de preload.js. Chaque abonnement retourne
  // une fonction de désabonnement à appeler (ex. dans un cleanup de composant/hook).

  /**
   * Un nouveau message a été reçu dans une conversation (salon ou DM) suivie par l'utilisateur.
   *
   * @param callback Fonction appelée à chaque nouveau message reçu, avec le message en paramètre.
   *
   * @returns Une fonction de désabonnement à appeler pour arrêter d'écouter les nouveaux messages.
   */
  lorsMessage(callback: (message: Message) => void): Desabonner;

  /**
   * La présence (connecté / déconnecté) d'un utilisateur a changé.
   *
   * @param callback Fonction appelée à chaque changement de présence, avec la présence en paramètre.
   *
   * @returns Une fonction de désabonnement à appeler pour arrêter d'écouter les changements de présence.
   */
  onPresence(callback: (presence: Presence) => void): Desabonner;

  /**
   * L'état de saisie (en train d'écrire / inactif) d'un utilisateur a changé dans une conversation suivie par l'utilisateur.
   *
   * @param callback Fonction appelée à chaque changement d'état de saisie, avec l'état de saisie en paramètre.
   *
   * @returns Une fonction de désabonnement à appeler pour arrêter d'écouter les changements d'état de saisie.
   */
  onSaisie(callback: (etat: EtatSaisie) => void): Desabonner;

  /**
   * L'état de connexion (connecté / déconnecté / reconnexion) a changé.
   *
   * @param callback Fonction appelée à chaque changement d'état de connexion, avec l'état de connexion en paramètre.
   *
   * @returns Une fonction de désabonnement à appeler pour arrêter d'écouter les changements d'état de connexion.
   */
  onEtatConnexion(callback: (etat: EtatConnexion) => void): Desabonner;

  /**
   * Un salon a été créé, modifié ou supprimé, ou l'utilisateur a été invité à un salon privé.
   *
   * @param callback Fonction appelée à chaque changement de salon, avec le salon en paramètre.
   *
   * @returns Une fonction de désabonnement à appeler pour arrêter d'écouter les changements de salon.
   */
  onSalon(callback: (salon: Salon) => void): Desabonner;
}
