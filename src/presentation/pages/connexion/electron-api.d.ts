export {};

import type { EtatConnexion } from '../../../domain/entities/EtatConnexion';

/**
 * Type de `window.electronAPI`, exposé par `preload.js` via contextBridge.
 * Tenu à jour manuellement en parallèle de preload.js (pas de génération
 * automatique) : chaque méthode ajoutée côté preload doit être répercutée
 * ici pour que le renderer TypeScript la voie.
 */
declare global {
  interface Window {
    electronAPI: {
      /** Vérifie si un pseudo est disponible (voir MockGatewayRuntime.pseudoDisponible côté main). */
      pseudoDisponible: (pseudo: string) => Promise<boolean>;
      /**
       * Crée/enregistre la session pour cet utilisateur dans le
       * MockGatewayRuntime PARTAGÉ côté main — c'est ce qui permet au
       * dashboard de connaître ensuite ce même utilisateur (voir
       * `obtenirUtilisateurConnecte`), plutôt qu'une instance de gateway
       * isolée dans le renderer de la page de connexion.
       */
      connexionSession: (utilisateur: {
        id: string;
        pseudo: string;
      }) => Promise<EtatConnexion>;
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
      obtenirUtilisateurConnecte: () => Promise<string | null>;
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
    };
  }
}
