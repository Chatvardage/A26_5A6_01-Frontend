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

  const THEMES = ['sombre', 'clair'];
  // Dernier thème appliqué, mémorisé pour la page SUIVANTE : chaque
  // navigation (salons ↔ messages privés ↔ profil) recharge un document
  // complet, et l'IPC 'theme:obtenir' est asynchrone — sans ce cache, la
  // page était d'abord peinte avec le thème par défaut du CSS (sombre), d'où
  // un flash avant l'arrivée du thème clair. Ce script est chargé dans
  // <head> pour que l'application ci-dessous précède le premier rendu.
  const CLEF_CACHE = 'chatvardage:theme';

  function appliquerTheme(theme) {
    if (!THEMES.includes(theme)) return;
    themeActuel = theme;
    global.document.documentElement.dataset.theme = theme;
    try {
      global.localStorage.setItem(CLEF_CACHE, theme);
    } catch {
      // Best-effort : sans stockage, seul le flash revient.
    }
  }

  // Textes statiques (data-i18n) masqués jusqu'à la première
  // I18n.appliquerTraductionsStatiques() (qui retire cette classe) : sinon le
  // texte écrit en dur dans le HTML apparaît une fraction de seconde avant la
  // traduction (ou dans la mauvaise langue). Filet de sécurité : retirée
  // quoi qu'il arrive après 1,5 s, pour ne jamais laisser une page sans texte.
  global.document.documentElement.classList.add('i18n-en-attente');
  global.setTimeout(
    () => global.document.documentElement.classList.remove('i18n-en-attente'),
    1500
  );

  // Changement de page sans « saut » : chaque page est un document complet
  // rechargé par Electron, dont le contenu arrivait par à-coups (listes
  // vides, puis remplies au fil des réponses réseau). Le cadre (barre de
  // titre, rail, fonds des colonnes) s'affiche tout de suite ; le contenu
  // est masqué jusqu'à ce que la page signale son premier rendu complet
  // (pagePrete), puis apparaît en fondu (voir .page-en-chargement dans
  // styles.css). Filet de sécurité : affiché quoi qu'il arrive après 2 s.
  global.document.documentElement.classList.add('page-en-chargement');
  function pagePrete() {
    global.document.documentElement.classList.remove('page-en-chargement');
  }
  global.setTimeout(pagePrete, 2000);

  try {
    const themeCache = global.localStorage.getItem(CLEF_CACHE);
    if (THEMES.includes(themeCache)) appliquerTheme(themeCache);
  } catch {
    // localStorage indisponible : repli sur le thème par défaut.
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
    pagePrete,
  });
})(window);
