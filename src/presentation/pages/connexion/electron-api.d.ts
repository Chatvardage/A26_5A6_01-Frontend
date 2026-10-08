export {};

import type { EtatConnexion } from '../../../domain/entities/EtatConnexion';
import type { Utilisateur } from '../../../domain/entities/Utilisateur';

/**
 * Type de `window.electronAPI`, exposé par `preload.js` via contextBridge.
 * Tenu à jour manuellement en parallèle de preload.js (pas de génération
 * automatique) : chaque méthode ajoutée côté preload doit être répercutée
 * ici pour que le renderer TypeScript la voie.
 */
declare global {
  interface Window {
    electronAPI: {
      /**
       * Authentifie un utilisateur déjà inscrit par pseudo OU courriel +
       * mot de passe (voir AuthGateway.ts). Voir LoginPage.tsx.
       */
      authentifierSession: (
        identifiant: string,
        motDePasse: string
      ) => Promise<{ utilisateur: Utilisateur; etatConnexion: EtatConnexion }>;
      /**
       * Inscrit un nouvel utilisateur (courriel + mot de passe ; le pseudo
       * par défaut est généré côté renderer, voir genererPseudoParDefaut
       * dans le domaine Utilisateur, et transmis ici — modifiable ensuite
       * sur l'écran "Choisis ton pseudo" ou la page profil). Voir
       * InscriptionPage.tsx.
       */
      inscriptionSession: (
        courriel: string,
        motDePasse: string,
        pseudo: string
      ) => Promise<{ utilisateur: Utilisateur; etatConnexion: EtatConnexion }>;
      /**
       * Reprend une session déjà ouverte lors d'un lancement précédent
       * (jeton persisté sur disque), appelée au démarrage de la page de
       * connexion pour sauter directement au tableau de bord si possible.
       * Retourne `null` si aucune session n'a pu être reprise.
       */
      restaurerSession: () => Promise<{
        utilisateur: Utilisateur;
        etatConnexion: EtatConnexion;
      } | null>;
      /** Déconnexion explicite (voir page profil). */
      deconnexionSession: () => Promise<void>;
      /** Enregistre le motif de retour automatique vers l’écran de connexion. */
      definirMotifRetourConnexion: (motif: string) => Promise<string | null>;
      /** Déconnexion de tous les appareils : invalide tous les jetons. */
      deconnexionPartout: () => Promise<void>;
      /**
       * Motif d'un retour automatique à cet écran (ex. 'session-expiree'
       * quand le jeton a expiré en cours d'utilisation), lu une seule fois ;
       * `null` après une déconnexion volontaire ou au démarrage.
       */
      obtenirMotifRetourConnexion: () => Promise<string | null>;
      /**
       * Demande au processus main de charger le tableau de bord (dashboard)
       * une fois la session locale établie. Le retour de navigation lui-même
       * se fait côté main (voir main.js, canal `navigation:tableau-de-bord`) ;
       * cette promesse se résout une fois la demande traitée.
       */
      allerAuTableauDeBord: () => Promise<void>;
      /**
       * Utilisée par le dashboard (renderer.js) au démarrage pour savoir qui
       * vient de se connecter via l'écran de connexion, au lieu de coder un
       * utilisateur en dur. Retourne `null` si personne ne s'est connecté
       * par ce biais (ex. dashboard ouvert directement en développement).
       */
      obtenirUtilisateurConnecte: () => Promise<Utilisateur | null>;
      /** Profil complet de l'utilisateur courant (GET /auth/me). */
      profilObtenir: () => Promise<Utilisateur>;
      /** Change le pseudo (3-20 caractères, unicité vérifiée serveur). */
      profilModifierPseudo: (pseudo: string) => Promise<Utilisateur>;
      /**
       * Change le courriel et/ou le mot de passe — `motDePasseActuel` est
       * toujours requis par le serveur pour ce type de changement.
       */
      profilModifierCompte: (donnees: {
        courriel?: string;
        motDePasse?: string;
        motDePasseActuel: string;
      }) => Promise<Utilisateur>;
      /** Supprime définitivement le compte courant et ferme la session. */
      profilSupprimerCompte: (motDePasseActuel: string) => Promise<void>;
      /** Retourne la langue actuellement sélectionnée ('fr' ou 'en'). */
      obtenirLangue: () => Promise<string>;
      /**
       * Change la langue de l'app (partagée entre connexion et dashboard,
       * voir main.js). Retourne la langue effectivement appliquée (repli
       * silencieux sur l'ancienne si la langue demandée n'est pas
       * supportée) — toujours utiliser cette valeur de retour plutôt que
       * supposer que la langue demandée a été acceptée telle quelle.
       */
      definirLangue: (langue: string) => Promise<string>;
      /** Retourne le thème actuellement sélectionné ('sombre' ou 'clair'). */
      obtenirTheme: () => Promise<string>;
      /**
       * Change le thème de l'app (partagé entre connexion et dashboard,
       * même principe que definirLangue). Retourne le thème effectivement
       * appliqué.
       */
      definirTheme: (theme: string) => Promise<string>;

      // À ajouter dans la déclaration electronAPI :
      allerALaConnexion: () => Promise<void>;
    };
  }
}
