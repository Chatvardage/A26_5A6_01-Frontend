import type { EtatConnexion } from '../../domain/entities/EtatConnexion.ts';
import type { Utilisateur } from '../../domain/entities/Utilisateur.ts';

/**
 * AuthGateway — contrat d'authentification, séparé de `ChatGateway`
 * (voir ChatGateway.ts) plutôt que d'y être ajouté directement : `ChatGateway`
 * expose déjà `connexion(utilisateur: Utilisateur)`, qui suppose un
 * utilisateur DÉJÀ identifié (ancien flux "pseudo seul, sans mot de passe").
 * Réutiliser ce même nom pour un login par identifiant + mot de passe
 * casserait sa signature pour toute implémentation existante de
 * `ChatGateway` (ex. MockGateway.ts, utilisé par les tests). `AuthGateway`
 * peut donc être implémenté EN PLUS de `ChatGateway` par une même classe
 * (voir HttpWebSocketGateway.ts) sans conflit de nom.
 */

/** Identifiants fournis à l'écran de connexion : pseudo OU courriel, au choix. */
export interface IdentifiantsConnexion {
  /** Pseudo ou courriel de l'utilisateur — le backend décide lequel c'est. */
  readonly identifiant: string;
  readonly motDePasse: string;
}

/** Identifiants fournis à l'écran d'inscription : courriel + mot de passe seulement (pas de pseudo, voir genererPseudoParDefaut). */
export interface IdentifiantsInscription {
  readonly courriel: string;
  readonly motDePasse: string;
}

/** Résultat commun à `authentifier` et `inscrire` : l'utilisateur obtenu, et l'état de connexion résultant (session ouverte côté gateway). */
export interface ResultatAuthentification {
  readonly utilisateur: Utilisateur;
  readonly etatConnexion: EtatConnexion;
}

export interface AuthGateway {
  /**
   * Authentifie un utilisateur déjà inscrit à partir de son pseudo OU de
   * son courriel, et de son mot de passe.
   *
   * @throws Rejette la promesse (message = code d'erreur stable, ex.
   * "ERR_IDENTIFIANTS_INVALIDES") si les identifiants sont invalides — voir
   * traduireErreurSoumission dans LoginPage.tsx pour la traduction de ce
   * code au moment de l'affichage.
   */
  authentifier(
    identifiants: IdentifiantsConnexion
  ): Promise<ResultatAuthentification>;

  /**
   * Inscrit un nouvel utilisateur à partir de son courriel et de son mot de
   * passe. Le pseudo n'est PAS demandé ici : un pseudo par défaut est dérivé
   * du courriel (voir genererPseudoParDefaut dans le domaine Utilisateur),
   * modifiable ensuite sur une autre page (page profil — pas encore prête,
   * voir le commentaire dans InscriptionPage.tsx).
   *
   * @throws Rejette la promesse (ex. "ERR_COURRIEL_DEJA_UTILISE") si le
   * courriel est déjà associé à un compte.
   */
  inscrire(
    identifiants: IdentifiantsInscription
  ): Promise<ResultatAuthentification>;
}
