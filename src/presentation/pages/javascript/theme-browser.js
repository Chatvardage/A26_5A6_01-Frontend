'use strict';

/**
 * Gestion du thème (clair/sombre) commune à index.html (renderer.js) et
 * message-prive.html (message-prive.js). Même pattern que window.I18n
 * (voir i18n-browser.js pour le raisonnement complet sur pourquoi un
 * script classique exposant un global, plutôt qu'un module) : chargé AVANT
 * ces deux fichiers, avec le même repli initial "sombre" (voir
 * THEME_PAR_DEFAUT côté main.js) le temps que le canal IPC réponde.
 *
 * Appliquer le thème revient à poser `data-theme` sur <html> : tout le
 * reste (styles.css, message-prive.css, connexion.css) réagit à cet
 * attribut via des blocs `:root[data-theme='clair'] { ... }` qui
 * redéfinissent les variables CSS existantes — aucune classe CSS
 * supplémentaire à gérer ici.
 */
(function (global) {
  let themeActuel = 'sombre';

  function appliquerTheme(theme) {
    themeActuel = theme;
    global.document.documentElement.dataset.theme = theme;
  }

  function obtenirTheme() {
    return themeActuel;
  }

  /**
   * Récupère le thème courant auprès du processus main et l'applique tout
   * de suite. À appeler une fois au démarrage de chaque page, comme
   * I18n.initialiserDepuisElectronAPI (voir aussi son commentaire pour le
   * choix d'allSettled — ici un seul canal, donc un simple try/catch
   * suffit).
   *
   * @param {object} electronAPI window.electronAPI (voir preload.js)
   * @returns {Promise<string>} le thème effectivement retenu
   */
  async function initialiserDepuisElectronAPI(electronAPI) {
    try {
      const theme = await electronAPI.obtenirTheme();
      appliquerTheme(theme);
    } catch {
      // Repli sur 'sombre' (valeur initiale) si le canal échoue.
      appliquerTheme(themeActuel);
    }
    return themeActuel;
  }

  global.ThemeManager = Object.freeze({
    appliquerTheme,
    obtenirTheme,
    initialiserDepuisElectronAPI,
  });
})(window);
