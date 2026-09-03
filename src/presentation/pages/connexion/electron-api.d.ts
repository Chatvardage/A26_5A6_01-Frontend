export {};

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
       * Demande au processus main de charger le tableau de bord (dashboard)
       * une fois la session locale établie. Le retour de navigation lui-même
       * se fait côté main (voir main.js, canal `navigation:tableau-de-bord`) ;
       * cette promesse se résout une fois la demande traitée.
       */
      allerAuTableauDeBord: () => Promise<void>;
    };
  }
}
