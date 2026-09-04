import type { Utilisateur } from '../../domain/entities/Utilisateur.js';
import type { Message } from '../../domain/entities/Message.js';
import type { Salon } from '../../domain/entities/Salon.js';
import type { Presence } from '../../domain/entities/Presence.js';
import type { ConversationId } from '../../domain/entities/Conversation.js';
import type { ConversationPrivee } from '../../domain/entities/ConversationPrivee.js';
import type { EtatConnexion } from '../../domain/entities/EtatConnexion.js';
import {
  creerUtilisateur,
  validationPseudo,
} from '../../domain/entities/Utilisateur.js';
import { creerMessage, AUTEUR_SYSTEME } from '../../domain/entities/Message.js';
import { creerSalon } from '../../domain/entities/Salon.js';
import { creerPresence } from '../../domain/entities/Presence.js';
import { creerEtatConnexion } from '../../domain/entities/EtatConnexion.js';
import {
  creerConversationPrivee,
  creerDmId,
} from '../../domain/entities/ConversationPrivee.js';

/**
 * Types d'événements pouvant être émis par le MockGateway
 */
export type TypeEvenement =
  | 'connexion'
  | 'deconnexion'
  | 'reconnexion'
  | 'utilisateur-connecte'
  | 'utilisateur-deconnecte'
  | 'utilisateur-rejoint-salon'
  | 'utilisateur-quitte-salon'
  | 'salon-cree'
  | 'salon-supprime'
  | 'invitation-salon-envoyee'
  | 'invitation-salon-acceptee'
  | 'invitation-salon-refusee'
  | 'message-recu'
  | 'message-modifie'
  | 'message-supprime'
  | 'presence-mise-a-jour'
  | 'erreur';

/**
 * Structure d'un événement
 */
export interface Evenement {
  readonly type: TypeEvenement;
  readonly donnees: Record<string, unknown>;
  readonly timestamp: number;
}

/**
 * Structure de rappel pour un événement
 */
export type EcouteurEvenement = (evenement: Evenement) => void;

/**
 * MockGateway — Simule un serveur de communication pour tester l'application
 * Simule la connexion, les utilisateurs, les salons, les messages et les événements
 */
export class MockGateway {
  private etatConnexion: EtatConnexion;
  private utilisateurs: Map<string, Utilisateur> = new Map();
  private presences: Map<string, Presence> = new Map();
  private salons: Map<ConversationId, Salon> = new Map();
  private conversationsPrivees: Map<ConversationId, ConversationPrivee> =
    new Map();
  private messages: Map<string, Message> = new Map();
  private ecouteurs: Map<TypeEvenement, EcouteurEvenement[]> = new Map();
  private latenceMs: number = 100; // Latence par défaut en millisecondes
  private utilisateurActuelId: string | null = null;
  private reconnexions: number = 0;
  private idCompteur: number = 0;

  constructor(latenceMs: number = 100) {
    this.latenceMs = latenceMs;
    this.etatConnexion = creerEtatConnexion('deconnecte', Date.now());
    this.initialiserDonneesMock();
  }

  /**
   * Initialise les données de test par défaut
   */
  private initialiserDonneesMock(): void {
    const user1 = creerUtilisateur('u1', 'sam');
    const user2 = creerUtilisateur('u2', 'ariane');
    const user3 = creerUtilisateur('u3', 'eva');
    const user4 = creerUtilisateur('u4', 'logan');
    const user5 = creerUtilisateur('u5', 'lili-rose');
    const user6 = creerUtilisateur('u6', 'fiona');

    this.utilisateurs.set(user1.id, user1);
    this.utilisateurs.set(user2.id, user2);
    this.utilisateurs.set(user3.id, user3);
    this.utilisateurs.set(user4.id, user4);
    this.utilisateurs.set(user5.id, user5);
    this.utilisateurs.set(user6.id, user6);

    this.presences.set(
      user1.id,
      creerPresence(user1.id, 'en-ligne', Date.now())
    );
    this.presences.set(
      user2.id,
      creerPresence(user2.id, 'hors-ligne', Date.now())
    );
    this.presences.set(
      user3.id,
      creerPresence(user3.id, 'en-ligne', Date.now())
    );
    this.presences.set(
      user4.id,
      creerPresence(user4.id, 'hors-ligne', Date.now())
    );
    this.presences.set(
      user5.id,
      creerPresence(user5.id, 'en-ligne', Date.now())
    );
    this.presences.set(
      user6.id,
      creerPresence(user6.id, 'hors-ligne', Date.now())
    );

    // Salon public : tous les utilisateurs existants en sont membres d'office
    // dès le seed (cohérent avec MockGatewayRuntime.js). Les salons publics
    // créés ensuite via creerSalon() démarrent eux avec le seul hôte, et se
    // remplissent via ajouterUtilisateurAuSalon() — comportement volontairement
    // différent, déjà couvert par les tests dédiés à creerSalon().
    const salon1 = creerSalon('s1', 'Général', user1.id, 'public', [
      user1.id,
      user2.id,
      user3.id,
      user4.id,
      user5.id,
      user6.id,
    ]);
    const salon2 = creerSalon('s2', 'Privé', user1.id, 'prive', [
      user1.id,
      user3.id,
    ]);

    this.salons.set(salon1.id, salon1);
    this.salons.set(salon2.id, salon2);

    const conversationsDM = [
      ['u1', 'u2'],
      ['u1', 'u3'],
      ['u1', 'u4'],
      ['u2', 'u5'],
      ['u3', 'u6'],
    ];

    for (const [a, b] of conversationsDM) {
      const conversation = creerConversationPrivee(a, b);
      this.conversationsPrivees.set(conversation.id, conversation);
    }

    const messagesDM = [
      {
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u1',
        contenu: 'Salut, on se voit ce soir ?',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u1', 'u2'),
        auteurId: 'u2',
        contenu: 'Oui, vers 20h, ça marche.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u3',
        contenu: 'Tu as vu le dernier sprint ?',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u1', 'u3'),
        auteurId: 'u1',
        contenu: 'Oui, je le valide demain.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u4',
        contenu: 'J’ai envoyé le document de synthèse.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u1', 'u4'),
        auteurId: 'u1',
        contenu: 'Parfait, je le relirai tout à l’heure.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u2', 'u5'),
        auteurId: 'u2',
        contenu: 'Le rapport est prêt pour relecture.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u2', 'u5'),
        auteurId: 'u5',
        contenu: 'Merci, je le regarde ce midi.',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u3', 'u6'),
        auteurId: 'u6',
        contenu: 'Tu as vu le dernier correctif ?',
        type: 'texte' as const,
      },
      {
        conversationId: creerDmId('u3', 'u6'),
        auteurId: 'u3',
        contenu: 'Oui, il a déjà été validé.',
        type: 'texte' as const,
      },
    ];

    const baseTimestamp = Date.now() - messagesDM.length * 60000;

    messagesDM.forEach((message, index) => {
      const msg = creerMessage(
        `msg-dm-${index + 1}`,
        message.conversationId,
        message.auteurId,
        message.contenu,
        baseTimestamp + index * 60000,
        message.type
      );
      this.messages.set(msg.id, msg);
    });
  }

  /**
   * Simule une connexion à l'application
   * @param utilisateurId L'identifiant de l'utilisateur à connecter
   * @returns Promise<void> qui se complète après la latence simulée
   */
  async simulerConnexion(utilisateurId: string): Promise<void> {
    return this.simulerLatence(async () =>
      this.simulerConnexionSansLatence(utilisateurId)
    );
  }

  /**
   * Logique synchrone de connexion, sans latence simulée. Extraite pour être
   * réutilisable par `simulerReconnexion` sans payer une seconde fois
   * `simulerLatence` (même principe que `ajouterUtilisateurAuSalonSansLatence`
   * pour `accepterInvitationSalon`).
   */
  private simulerConnexionSansLatence(utilisateurId: string): void {
    const utilisateur = this.utilisateurs.get(utilisateurId);
    if (!utilisateur) {
      this.emetEvenement('erreur', {
        message: `Utilisateur ${utilisateurId} non trouvé`,
      });
      throw new Error(`Utilisateur ${utilisateurId} non trouvé`);
    }

    this.utilisateurActuelId = utilisateurId;
    this.etatConnexion = creerEtatConnexion(
      'connecte',
      Date.now(),
      this.reconnexions
    );

    // Mettre à jour la présence de l'utilisateur
    const presence = creerPresence(utilisateurId, 'en-ligne', Date.now());
    this.presences.set(utilisateurId, presence);

    // Émettre un événement de connexion
    this.emetEvenement('connexion', {
      utilisateurId,
      utilisateur,
    });

    // Émettre un message système dans les salons
    const salonsUtilisateur = Array.from(this.salons.values()).filter(
      (salon) =>
        salon.membreIds.includes(utilisateurId) ||
        salon.membresInvites.includes(utilisateurId)
    );

    for (const salon of salonsUtilisateur) {
      const messageSysteme = creerMessage(
        `msg-${this.genererIdUnique()}`,
        salon.id,
        AUTEUR_SYSTEME,
        `${utilisateur.pseudo} a rejoint le salon`,
        Date.now(),
        'systeme'
      );
      this.messages.set(messageSysteme.id, messageSysteme);
      this.emetEvenement('message-recu', { message: messageSysteme });
    }

    // Diffuser la présence de l'utilisateur
    this.emetEvenement('presence-mise-a-jour', { presence });
  }

  /**
   * Simule une déconnexion de l'application
   * @returns Promise<void> qui se complète après la latence simulée
   */
  async simulerDeconnexion(): Promise<void> {
    return this.simulerLatence(async () => {
      if (!this.utilisateurActuelId) {
        this.emetEvenement('erreur', {
          message: 'Aucun utilisateur connecté',
        });
        throw new Error('Aucun utilisateur connecté');
      }

      const utilisateurId = this.utilisateurActuelId;
      const utilisateur = this.utilisateurs.get(utilisateurId);

      // Mettre à jour la présence
      if (utilisateur) {
        const presence = creerPresence(utilisateurId, 'hors-ligne', Date.now());
        this.presences.set(utilisateurId, presence);
        this.emetEvenement('presence-mise-a-jour', { presence });

        // Émettre un message système dans les salons
        const salonsUtilisateur = Array.from(this.salons.values()).filter(
          (salon) =>
            salon.membreIds.includes(utilisateurId) ||
            salon.membresInvites.includes(utilisateurId)
        );

        for (const salon of salonsUtilisateur) {
          const messageSysteme = creerMessage(
            `msg-${this.genererIdUnique()}`,
            salon.id,
            AUTEUR_SYSTEME,
            `${utilisateur.pseudo} a quitté le salon`,
            Date.now(),
            'systeme'
          );
          this.messages.set(messageSysteme.id, messageSysteme);
          this.emetEvenement('message-recu', {
            message: messageSysteme,
          });
        }
      }

      this.etatConnexion = creerEtatConnexion(
        'deconnecte',
        Date.now(),
        this.reconnexions
      );
      this.utilisateurActuelId = null;

      this.emetEvenement('deconnexion', { utilisateurId });
    });
  }

  /**
   * Simule une reconnexion après une déconnexion
   * @param utilisateurId L'identifiant de l'utilisateur à reconnecter
   * @returns Promise<void> qui se complète après la latence simulée
   */
  async simulerReconnexion(utilisateurId: string): Promise<void> {
    return this.simulerLatence(async () => {
      this.reconnexions++;

      this.etatConnexion = creerEtatConnexion(
        'reconnexion',
        Date.now(),
        this.reconnexions
      );

      this.emetEvenement('reconnexion', {
        utilisateurId,
        reconnexions: this.reconnexions,
      });

      try {
        // Réutilise la logique de connexion sans repayer une seconde
        // latence : simulerLatence() ci-dessus simule déjà l'unique
        // aller-retour réseau de cette opération (même principe que
        // accepterInvitationSalon / ajouterUtilisateurAuSalonSansLatence).
        this.simulerConnexionSansLatence(utilisateurId);
      } catch (erreur) {
        // La tentative de reconnexion a échoué : ne pas laisser l'état
        // coincé sur 'reconnexion' indéfiniment. obtenirUtilisateurConnecte()
        // reste `null` dans ce cas (simulerConnexionSansLatence n'a pas pu
        // définir utilisateurActuelId), donc 'deconnecte' reflète la réalité.
        this.etatConnexion = creerEtatConnexion(
          'deconnecte',
          Date.now(),
          this.reconnexions
        );
        throw erreur;
      }
    });
  }

  /**
   * Définit la latence simulée pour toutes les opérations
   * @param latenceMs Latence en millisecondes
   */
  definirLatence(latenceMs: number): void {
    this.latenceMs = latenceMs;
  }

  /**
   * Ajoute un nouvel écouteur d'événement
   * @param typeEvenement Le type d'événement à écouter
   * @param ecouteur La fonction à appeler quand l'événement est émis
   */
  ecouterEvenement(
    typeEvenement: TypeEvenement,
    ecouteur: EcouteurEvenement
  ): void {
    if (!this.ecouteurs.has(typeEvenement)) {
      this.ecouteurs.set(typeEvenement, []);
    }
    this.ecouteurs.get(typeEvenement)!.push(ecouteur);
  }

  /**
   * Retire un écouteur d'événement
   * @param typeEvenement Le type d'événement
   * @param ecouteur La fonction à retirer
   */
  retirerEcouteur(
    typeEvenement: TypeEvenement,
    ecouteur: EcouteurEvenement
  ): void {
    if (this.ecouteurs.has(typeEvenement)) {
      const ecouteurs = this.ecouteurs.get(typeEvenement)!;
      const index = ecouteurs.indexOf(ecouteur);
      if (index > -1) {
        ecouteurs.splice(index, 1);
      }
    }
  }

  /**
   * Vérifie si un pseudo est disponible (aucun utilisateur enregistré ne le
   * porte déjà), en comparaison insensible à la casse. Simule une latence
   * réseau comme les autres opérations du gateway. Implémente
   * `ChatGateway.pseudoDisponible` (voir aussi le TODO historique sur
   * `validationPseudo` dans `Utilisateur.ts`, qui ne fait volontairement
   * que la validation de FORMAT — l'unicité dépend d'un registre, donc de
   * la couche gateway, pas du domaine pur).
   *
   * ATTENTION concurrence : cette vérification n'est pas atomique avec
   * l'écriture qui la suit (voir `creerUtilisateur`/`connexion`). Deux
   * créations concurrentes du même pseudo peuvent toutes deux passer cette
   * vérification avant que l'une n'écrive dans `this.utilisateurs` (TOCTOU).
   * Sans impact réel ici (mock/démo, usage mono-utilisateur local), mais une
   * future implémentation réseau réelle devra faire un check-and-set atomique
   * côté serveur.
   * @param pseudo Le pseudo à vérifier.
   * @returns Promise<boolean> `true` si disponible, `false` si déjà pris.
   */
  async pseudoDisponible(pseudo: string): Promise<boolean> {
    return this.simulerLatence(async () =>
      this.pseudoDisponibleSansLatence(pseudo)
    );
  }

  /**
   * Logique synchrone de vérification de disponibilité, sans latence
   * simulée. Extraite pour être réutilisable par `creerUtilisateur` sans
   * payer une seconde fois `simulerLatence` (même principe que
   * `ajouterUtilisateurAuSalonSansLatence` / `simulerConnexionSansLatence`) :
   * `creerUtilisateur` est déjà lui-même enveloppé dans `simulerLatence`,
   * donc appeler `pseudoDisponible` (async, avec sa propre latence) depuis
   * son intérieur doublait artificiellement le délai d'une seule opération
   * logique.
   */
  private pseudoDisponibleSansLatence(pseudo: string): boolean {
    const pseudoNormalise = pseudo.trim().toLowerCase();
    const dejaPris = Array.from(this.utilisateurs.values()).some(
      (u) => u.pseudo.toLowerCase() === pseudoNormalise
    );
    return !dejaPris;
  }

  /**
   * Crée un nouvel utilisateur
   * @param pseudo Le pseudo de l'utilisateur
   * @returns Promise<Utilisateur> L'utilisateur créé
   */
  async creerUtilisateur(pseudo: string): Promise<Utilisateur> {
    return this.simulerLatence(async () => {
      if (!validationPseudo(pseudo)) {
        this.emetEvenement('erreur', {
          message: `Pseudo invalide : ${pseudo}`,
        });
        throw new Error(`Pseudo invalide : ${pseudo}`);
      }

      // Unicité (voir pseudoDisponible) : on ne s'appuie pas uniquement sur
      // la vérification préalable côté UI — le gateway reste la source de
      // vérité, au cas où deux créations concurrentes arriveraient ici.
      // Version SansLatence : cette méthode est déjà enveloppée dans
      // simulerLatence ci-dessus, appeler la variante publique (async, avec
      // sa propre latence) doublerait le délai simulé pour une seule
      // opération logique (voir le commentaire sur pseudoDisponibleSansLatence).
      const disponible = this.pseudoDisponibleSansLatence(pseudo);
      if (!disponible) {
        this.emetEvenement('erreur', {
          message: `Pseudo déjà utilisé : ${pseudo}`,
        });
        throw new Error(`Pseudo déjà utilisé : ${pseudo}`);
      }

      const utilisateur = creerUtilisateur(
        `u${this.genererIdUnique()}`,
        pseudo
      );
      this.utilisateurs.set(utilisateur.id, utilisateur);

      this.emetEvenement('utilisateur-connecte', { utilisateur });

      return utilisateur;
    });
  }

  /**
   * Établit la connexion pour un utilisateur et crée sa session locale.
   * Implémente `ChatGateway.connexion`. S'appuie sur les primitives déjà
   * existantes du MockGateway : enregistre l'utilisateur s'il est nouveau
   * (en revérifiant l'unicité du pseudo, défense en profondeur — voir
   * `creerUtilisateur`), puis délègue à `simulerConnexion` pour l'état de
   * connexion, la présence et les événements.
   * @param utilisateur L'utilisateur qui se connecte (pseudo déjà validé côté UI).
   * @returns Promise<EtatConnexion> L'état de connexion résultant.
   * @throws Si le pseudo est déjà utilisé par un autre utilisateur enregistré.
   */
  async connexion(utilisateur: Utilisateur): Promise<EtatConnexion> {
    const dejaEnregistre = this.utilisateurs.has(utilisateur.id);

    if (!dejaEnregistre) {
      const disponible = await this.pseudoDisponible(utilisateur.pseudo);
      if (!disponible) {
        this.emetEvenement('erreur', {
          message: `Pseudo déjà utilisé : ${utilisateur.pseudo}`,
        });
        throw new Error(`Pseudo déjà utilisé : ${utilisateur.pseudo}`);
      }
      this.utilisateurs.set(utilisateur.id, utilisateur);
    }

    await this.simulerConnexion(utilisateur.id);
    return this.etatConnexion;
  }

  /**
   * Récupère un utilisateur par son ID
   * @param utilisateurId L'identifiant de l'utilisateur
   * @returns Promise<Utilisateur | undefined> L'utilisateur ou undefined
   */
  async obtenirUtilisateur(
    utilisateurId: string
  ): Promise<Utilisateur | undefined> {
    return this.simulerLatence(async () => {
      return this.utilisateurs.get(utilisateurId);
    });
  }

  /**
   * Récupère tous les utilisateurs
   * @returns Promise<Utilisateur[]> Liste de tous les utilisateurs
   */
  async obtenirTousLesUtilisateurs(): Promise<Utilisateur[]> {
    return this.simulerLatence(async () => {
      return Array.from(this.utilisateurs.values());
    });
  }

  /**
   * Récupère la présence d'un utilisateur
   * @param utilisateurId L'identifiant de l'utilisateur
   * @returns Promise<Presence | undefined> La présence de l'utilisateur
   */
  async obtenirPresence(utilisateurId: string): Promise<Presence | undefined> {
    return this.simulerLatence(async () => {
      return this.presences.get(utilisateurId);
    });
  }

  /**
   * Crée un nouveau salon de discussion
   * @param nom Nom du salon
   * @param hoteId Identifiant de l'hôte
   * @param visibilite Visibilité du salon ('public' ou 'prive')
   * @returns Promise<Salon> Le salon créé
   */
  async creerSalon(
    nom: string,
    hoteId: string,
    visibilite: 'public' | 'prive' = 'public'
  ): Promise<Salon> {
    return this.simulerLatence(async () => {
      const utilisateur = this.utilisateurs.get(hoteId);
      if (!utilisateur) {
        this.emetEvenement('erreur', {
          message: `Hôte ${hoteId} non trouvé`,
        });
        throw new Error(`Hôte ${hoteId} non trouvé`);
      }

      const salon = creerSalon(
        `s${this.genererIdUnique()}`,
        nom,
        hoteId,
        visibilite
      );
      this.salons.set(salon.id, salon);

      this.emetEvenement('salon-cree', { salon });

      return salon;
    });
  }

  /**
   * Récupère un salon par son ID
   * @param salonId L'identifiant du salon
   * @returns Promise<Salon | undefined> Le salon ou undefined
   */
  async obtenirSalon(salonId: ConversationId): Promise<Salon | undefined> {
    return this.simulerLatence(async () => {
      return this.salons.get(salonId);
    });
  }

  /**
   * Récupère tous les salons
   * @returns Promise<Salon[]> Liste de tous les salons
   */
  async obtenirTousLesSalons(): Promise<Salon[]> {
    return this.simulerLatence(async () => {
      return Array.from(this.salons.values());
    });
  }

  /** Invite localement un utilisateur dans un salon privé. Seul l'hôte peut inviter. */
  async inviterUtilisateurAuSalon(
    salonId: ConversationId,
    utilisateurId: string,
    hoteId: string
  ): Promise<Salon> {
    return this.simulerLatence(async () => {
      const salon = this.salons.get(salonId);
      if (!salon) throw new Error(`Salon ${salonId} non trouvé`);
      if (salon.visibilite === 'public') {
        throw new Error(
          `Les invitations sont désactivées pour le salon public ${salonId}`
        );
      }
      if (salon.hoteId !== hoteId) {
        throw new Error(`Seul l'hôte peut inviter dans le salon ${salonId}`);
      }
      if (!this.utilisateurs.has(utilisateurId)) {
        throw new Error(`Utilisateur ${utilisateurId} non trouvé`);
      }
      if (salon.membreIds.includes(utilisateurId)) return salon;

      const salonMisAJour = salon.membresInvites.includes(utilisateurId)
        ? salon
        : {
            ...salon,
            membresInvites: [...salon.membresInvites, utilisateurId],
          };
      this.salons.set(salonId, salonMisAJour);
      this.emetEvenement('invitation-salon-envoyee', {
        salonId,
        utilisateurId,
        hoteId,
      });
      return salonMisAJour;
    });
  }

  /** Retourne les invitations en attente d'un utilisateur. */
  async obtenirInvitationsUtilisateur(utilisateurId: string): Promise<Salon[]> {
    return this.simulerLatence(async () =>
      Array.from(this.salons.values()).filter((salon) =>
        salon.membresInvites.includes(utilisateurId)
      )
    );
  }

  /** Accepte une invitation et ajoute l'utilisateur aux membres du salon. */
  async accepterInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.simulerLatence(async () => {
      const salon = this.salons.get(salonId);
      if (!salon) throw new Error(`Salon ${salonId} non trouvé`);
      if (!salon.membresInvites.includes(utilisateurId)) {
        throw new Error(`Aucune invitation au salon ${salonId}`);
      }
      // Réutilise la logique d'ajout sans repayer une seconde latence :
      // simulerLatence() ci-dessus simule déjà l'unique aller-retour réseau
      // de cette opération.
      const salonMisAJour = this.ajouterUtilisateurAuSalonSansLatence(
        salonId,
        utilisateurId
      );
      this.emetEvenement('invitation-salon-acceptee', {
        salonId,
        utilisateurId,
      });
      return salonMisAJour;
    });
  }

  /** Refuse une invitation sans donner accès au salon. */
  async refuserInvitationSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.simulerLatence(async () => {
      const salon = this.salons.get(salonId);
      if (!salon) throw new Error(`Salon ${salonId} non trouvé`);
      if (!salon.membresInvites.includes(utilisateurId)) {
        throw new Error(`Aucune invitation au salon ${salonId}`);
      }
      const salonMisAJour = {
        ...salon,
        membresInvites: salon.membresInvites.filter(
          (id) => id !== utilisateurId
        ),
      };
      this.salons.set(salonId, salonMisAJour);
      this.emetEvenement('invitation-salon-refusee', {
        salonId,
        utilisateurId,
      });
      return salonMisAJour;
    });
  }

  /**
   * Ajoute un utilisateur à un salon
   * @param salonId L'identifiant du salon
   * @param utilisateurId L'identifiant de l'utilisateur
   * @returns Promise<Salon> Le salon mis à jour
   */
  async ajouterUtilisateurAuSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.simulerLatence(async () =>
      this.ajouterUtilisateurAuSalonSansLatence(salonId, utilisateurId)
    );
  }

  /**
   * Logique synchrone d'ajout d'un utilisateur à un salon, sans latence simulée.
   * Extraite de `ajouterUtilisateurAuSalon` pour être réutilisable par
   * `accepterInvitationSalon` sans payer une seconde fois `simulerLatence`
   * (chaque méthode publique ne doit simuler qu'un seul aller-retour réseau).
   */
  private ajouterUtilisateurAuSalonSansLatence(
    salonId: ConversationId,
    utilisateurId: string
  ): Salon {
    const salon = this.salons.get(salonId);
    if (!salon) {
      this.emetEvenement('erreur', {
        message: `Salon ${salonId} non trouvé`,
      });
      throw new Error(`Salon ${salonId} non trouvé`);
    }

    const utilisateur = this.utilisateurs.get(utilisateurId);
    if (!utilisateur) {
      this.emetEvenement('erreur', {
        message: `Utilisateur ${utilisateurId} non trouvé`,
      });
      throw new Error(`Utilisateur ${utilisateurId} non trouvé`);
    }

    if (!salon.membreIds.includes(utilisateurId)) {
      const estInvite = salon.membresInvites.includes(utilisateurId);
      if (salon.visibilite === 'prive' && !estInvite) {
        this.emetEvenement('erreur', {
          message: `Accès refusé au salon privé ${salonId}`,
        });
        throw new Error(`Accès refusé au salon privé ${salonId}`);
      }
      const salonMisAJour = {
        ...salon,
        membreIds: [...salon.membreIds, utilisateurId],
        membresInvites: estInvite
          ? salon.membresInvites.filter((id) => id !== utilisateurId)
          : salon.membresInvites,
      };
      this.salons.set(salonId, salonMisAJour);
      this.emetEvenement('utilisateur-rejoint-salon', {
        salonId,
        utilisateurId,
        utilisateur,
      });

      // Créer un message système
      const messageSysteme = creerMessage(
        `msg-${this.genererIdUnique()}`,
        salonId,
        AUTEUR_SYSTEME,
        `${utilisateur.pseudo} a rejoint le salon`,
        Date.now(),
        'systeme'
      );
      this.messages.set(messageSysteme.id, messageSysteme);
      this.emetEvenement('message-recu', { message: messageSysteme });

      return salonMisAJour;
    }

    return salon;
  }

  /**
   * Retire un utilisateur d'un salon
   * @param salonId L'identifiant du salon
   * @param utilisateurId L'identifiant de l'utilisateur
   * @returns Promise<Salon> Le salon mis à jour
   */
  async retirerUtilisateurDuSalon(
    salonId: ConversationId,
    utilisateurId: string
  ): Promise<Salon> {
    return this.simulerLatence(async () => {
      const salon = this.salons.get(salonId);
      if (!salon) {
        this.emetEvenement('erreur', {
          message: `Salon ${salonId} non trouvé`,
        });
        throw new Error(`Salon ${salonId} non trouvé`);
      }

      const utilisateur = this.utilisateurs.get(utilisateurId);
      if (!utilisateur) {
        this.emetEvenement('erreur', {
          message: `Utilisateur ${utilisateurId} non trouvé`,
        });
        throw new Error(`Utilisateur ${utilisateurId} non trouvé`);
      }

      if (salon.membreIds.includes(utilisateurId)) {
        if (salon.hoteId === utilisateurId) {
          this.emetEvenement('erreur', {
            message: `L'hôte ${utilisateurId} ne peut pas quitter le salon ${salonId}`,
          });
          throw new Error(
            `L'hôte ${utilisateurId} ne peut pas quitter le salon ${salonId}`
          );
        }
        const salonMisAJour = {
          ...salon,
          membreIds: salon.membreIds.filter((id) => id !== utilisateurId),
        };
        this.salons.set(salonId, salonMisAJour);

        this.emetEvenement('utilisateur-quitte-salon', {
          salonId,
          utilisateurId,
          utilisateur,
        });

        // Créer un message système
        const messageSysteme = creerMessage(
          `msg-${this.genererIdUnique()}`,
          salonId,
          AUTEUR_SYSTEME,
          `${utilisateur.pseudo} a quitté le salon`,
          Date.now(),
          'systeme'
        );
        this.messages.set(messageSysteme.id, messageSysteme);
        this.emetEvenement('message-recu', { message: messageSysteme });

        return salonMisAJour;
      }

      return salon;
    });
  }

  /**
   * Supprime un salon
   * @param salonId L'identifiant du salon
   * @returns Promise<void>
   */
  async supprimerSalon(salonId: ConversationId): Promise<void> {
    return this.simulerLatence(async () => {
      const salon = this.salons.get(salonId);
      if (!salon) {
        this.emetEvenement('erreur', {
          message: `Salon ${salonId} non trouvé`,
        });
        throw new Error(`Salon ${salonId} non trouvé`);
      }

      this.salons.delete(salonId);
      this.emetEvenement('salon-supprime', { salonId });
    });
  }

  /**
   * Envoie un message dans une conversation
   * @param conversationId L'identifiant de la conversation
   * @param auteurId L'identifiant de l'auteur
   * @param contenu Le contenu du message
   * @returns Promise<Message> Le message envoyé
   */
  async envoyerMessage(
    conversationId: ConversationId,
    auteurId: string,
    contenu: string
  ): Promise<Message> {
    return this.simulerLatence(async () => {
      const auteur = this.utilisateurs.get(auteurId);
      if (!auteur) {
        this.emetEvenement('erreur', {
          message: `Auteur ${auteurId} non trouvé`,
        });
        throw new Error(`Auteur ${auteurId} non trouvé`);
      }

      const salon = this.salons.get(conversationId);
      const conversationPrivee = this.conversationsPrivees.get(conversationId);

      if (salon) {
        if (!salon.membreIds.includes(auteurId)) {
          throw new Error(`Accès refusé au salon ${conversationId}`);
        }
      } else if (conversationPrivee) {
        if (!conversationPrivee.participantIds.includes(auteurId)) {
          throw new Error(`Accès refusé à la conversation ${conversationId}`);
        }
      } else {
        throw new Error(`Conversation ${conversationId} introuvable`);
      }

      const message = creerMessage(
        `msg-${this.genererIdUnique()}`,
        conversationId,
        auteurId,
        contenu,
        Date.now(),
        'texte'
      );

      this.messages.set(message.id, message);
      this.emetEvenement('message-recu', { message });

      return message;
    });
  }

  /**
   * Récupère un message par son ID
   * @param messageId L'identifiant du message
   * @returns Promise<Message | undefined> Le message ou undefined
   */
  async obtenirMessage(messageId: string): Promise<Message | undefined> {
    return this.simulerLatence(async () => {
      return this.messages.get(messageId);
    });
  }

  /**
   * Récupère tous les messages d'une conversation
   * @param conversationId L'identifiant de la conversation
   * @returns Promise<Message[]> Liste des messages
   */
  async obtenirMessagesConversation(
    conversationId: ConversationId
  ): Promise<Message[]> {
    return this.simulerLatence(async () => {
      return Array.from(this.messages.values()).filter(
        (message) => message.conversationId === conversationId
      );
    });
  }

  /**
   * Modifie un message
   * @param messageId L'identifiant du message
   * @param contenuNouveau Le nouveau contenu
   * @returns Promise<Message> Le message modifié
   */
  async modifierMessage(
    messageId: string,
    contenuNouveau: string
  ): Promise<Message> {
    return this.simulerLatence(async () => {
      const message = this.messages.get(messageId);
      if (!message) {
        this.emetEvenement('erreur', {
          message: `Message ${messageId} non trouvé`,
        });
        throw new Error(`Message ${messageId} non trouvé`);
      }

      const messageModifie = {
        ...message,
        contenu: contenuNouveau,
        modification: Date.now(),
      };

      this.messages.set(messageId, messageModifie);
      this.emetEvenement('message-modifie', { message: messageModifie });

      return messageModifie;
    });
  }

  /**
   * Supprime un message
   * @param messageId L'identifiant du message
   * @returns Promise<void>
   */
  async supprimerMessage(messageId: string): Promise<void> {
    return this.simulerLatence(async () => {
      const message = this.messages.get(messageId);
      if (!message) {
        this.emetEvenement('erreur', {
          message: `Message ${messageId} non trouvé`,
        });
        throw new Error(`Message ${messageId} non trouvé`);
      }

      this.messages.delete(messageId);
      this.emetEvenement('message-supprime', { messageId });
    });
  }

  /**
   * Crée une conversation privée entre deux utilisateurs
   * @param utilisateurAId L'identifiant du premier utilisateur
   * @param utilisateurBId L'identifiant du deuxième utilisateur
   * @returns Promise<ConversationPrivee> La conversation privée créée
   */
  async creerConversationPrivee(
    utilisateurAId: string,
    utilisateurBId: string
  ): Promise<ConversationPrivee> {
    return this.simulerLatence(async () => {
      const userA = this.utilisateurs.get(utilisateurAId);
      const userB = this.utilisateurs.get(utilisateurBId);

      if (!userA || !userB) {
        this.emetEvenement('erreur', {
          message: "Un des utilisateurs n'a pas été trouvé",
        });
        throw new Error("Un des utilisateurs n'a pas été trouvé");
      }

      const conversation = creerConversationPrivee(
        utilisateurAId,
        utilisateurBId
      );
      this.conversationsPrivees.set(conversation.id, conversation);

      return conversation;
    });
  }

  /**
   * Démarre une conversation privée avec un autre utilisateur, ou retourne
   * l'existante si les deux utilisateurs ont déjà un DM (même schéma d'ID
   * trié que creerDmId : idempotent, jamais de doublon). Miroir de
   * `demarrerConversationPrivee` dans MockGatewayRuntime.js (câblé dans
   * l'app réelle via main.js) — cette version tient le même contrat côté
   * mock de domaine couvert par la suite de tests.
   * @param utilisateurActuelId L'identifiant de l'utilisateur courant
   * @param autreUtilisateurId L'identifiant de l'autre utilisateur
   * @returns Promise<ConversationPrivee> La conversation privée (existante ou nouvellement créée)
   */
  async demarrerConversationPrivee(
    utilisateurActuelId: string,
    autreUtilisateurId: string
  ): Promise<ConversationPrivee> {
    return this.simulerLatence(async () => {
      if (utilisateurActuelId === autreUtilisateurId) {
        this.emetEvenement('erreur', {
          message: 'Impossible de démarrer une conversation avec soi-même',
        });
        throw new Error(
          'Impossible de démarrer une conversation avec soi-même'
        );
      }

      const utilisateurActuel = this.utilisateurs.get(utilisateurActuelId);
      const autreUtilisateur = this.utilisateurs.get(autreUtilisateurId);
      if (!utilisateurActuel || !autreUtilisateur) {
        this.emetEvenement('erreur', {
          message: "Un des utilisateurs n'a pas été trouvé",
        });
        throw new Error("Un des utilisateurs n'a pas été trouvé");
      }

      const conversationId = creerDmId(utilisateurActuelId, autreUtilisateurId);
      const conversationExistante =
        this.conversationsPrivees.get(conversationId);
      if (conversationExistante) {
        return conversationExistante;
      }

      const conversation = creerConversationPrivee(
        utilisateurActuelId,
        autreUtilisateurId
      );
      this.conversationsPrivees.set(conversation.id, conversation);

      return conversation;
    });
  }

  /**
   * Récupère une conversation privée par son ID
   * @param conversationId L'identifiant de la conversation
   * @returns Promise<ConversationPrivee | undefined> La conversation ou undefined
   */
  async obtenirConversationPrivee(
    conversationId: ConversationId
  ): Promise<ConversationPrivee | undefined> {
    return this.simulerLatence(async () => {
      return this.conversationsPrivees.get(conversationId);
    });
  }

  /**
   * Obtient l'état de connexion actuel
   * @returns EtatConnexion L'état de connexion
   */
  obtenirEtatConnexion(): EtatConnexion {
    return this.etatConnexion;
  }

  /**
   * Obtient l'utilisateur actuellement connecté
   * @returns string | null L'identifiant de l'utilisateur ou null
   */
  obtenirUtilisateurConnecte(): string | null {
    return this.utilisateurActuelId;
  }

  /**
   * Réinitialise le MockGateway à son état initial
   */
  reinitialiser(): void {
    this.utilisateurs.clear();
    this.presences.clear();
    this.salons.clear();
    this.conversationsPrivees.clear();
    this.messages.clear();
    this.ecouteurs.clear();
    this.utilisateurActuelId = null;
    this.reconnexions = 0;
    this.idCompteur = 0;
    this.etatConnexion = creerEtatConnexion('deconnecte', Date.now());
  }

  /**
   * Émet un événement à tous les écouteurs enregistrés
   * @param type Le type d'événement
   * @param donnees Les données de l'événement
   */
  private emetEvenement(
    type: TypeEvenement,
    donnees: Record<string, unknown>
  ): void {
    const evenement: Evenement = {
      type,
      donnees,
      timestamp: Date.now(),
    };

    if (this.ecouteurs.has(type)) {
      this.ecouteurs.get(type)!.forEach((ecouteur) => {
        ecouteur(evenement);
      });
    }
  }

  /**
   * Simule une latence réseau
   * @param operation La fonction asynchrone à exécuter
   * @returns Promise<T> Le résultat de l'opération
   */
  private async simulerLatence<T>(operation: () => Promise<T>): Promise<T> {
    await this.attendreLatence();
    return operation();
  }

  /**
   * Attend la latence définie
   *
   * Utilise `this.latenceMs` tel quel : la version précédente ajoutait un
   * padding arbitraire (`Math.max(this.latenceMs, 1) + 5`), ce qui faisait
   * mentir cette méthode par rapport à son propre nom et à `definirLatence` —
   * un appelant qui fixe `latenceMs` à 0 (ex. pour accélérer des tests) s'
   * attend à ne payer aucun délai artificiel, pas +5ms. `setTimeout` reste de
   * toute façon asynchrone même avec un délai de 0, donc rien ne redevient
   * synchrone ici.
   * @returns Promise<void>
   */
  private attendreLatence(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, this.latenceMs);
    });
  }

  /**
   * Génère un identifiant unique
   * @returns string Un identifiant unique
   */
  private genererIdUnique(): string {
    return String(this.idCompteur++);
  }
}

/**
 * Crée une instance du MockGateway avec une latence par défaut
 * @param latenceMs Latence en millisecondes
 * @returns MockGateway Une instance du MockGateway
 */
export function creerMockGateway(latenceMs: number = 100): MockGateway {
  return new MockGateway(latenceMs);
}
