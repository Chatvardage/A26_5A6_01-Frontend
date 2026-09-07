'use strict';

/**
 * Logique i18n commune à index.html (renderer.js) et message-prive.html
 * (message-prive.js). Chargé comme script classique (pas un module) AVANT
 * ces deux fichiers, pour exposer `window.I18n` comme un global simple —
 * même pattern que window.NotifPrefs (voir notif-prefs.js pour le
 * raisonnement complet). Avant ce fichier, t() / appliquerTraductionsStatiques()
 * / messageErreur() (et la logique d'initialisation au démarrage) étaient
 * copiées-collées à l'identique dans renderer.js ET message-prive.js —
 * exactement le genre de risque de divergence que window.NotifPrefs évite
 * déjà pour les préférences de notification (deux copies qui doivent être
 * tenues manuellement synchronisées finissent tôt ou tard par diverger).
 *
 * Pas de require() ici non plus, pour la même raison que dans
 * renderer.js/message-prive.js à l'origine : nodeIntegration est désactivé,
 * donc translations.json est demandé UNE FOIS au démarrage via IPC (voir
 * initialiserDepuisElectronAPI ci-dessous) plutôt qu'importé directement.
 * Voir aussi src/i18n/i18n.js et src/i18n/i18n-web.ts pour les deux autres
 * copies de cette même fonction de lookup, dans les mondes CommonJS/ESM du
 * projet où require()/import fonctionnent (translations.json reste
 * l'unique source des textes eux-mêmes, dans les trois cas).
 */
(function (global) {
  let dictionnaires = null; // rempli par initialiserDepuisElectronAPI()
  // 'fr' ici n'est qu'un repli de tout dernier recours pour la toute
  // première fraction de seconde avant qu'initialiserDepuisElectronAPI()
  // n'ait pu joindre le processus main (pas d'IPC synchrone possible à ce
  // stade) : dès que 'i18n:langue-par-defaut' répond, langueParDefaut est
  // réaligné sur LANGUE_PAR_DEFAUT (src/i18n/i18n.js), la vraie source de
  // vérité — évite de dupliquer cette constante en dur sans lien avec
  // l'original.
  let langueActuelle = 'fr';
  let langueParDefaut = 'fr';

  function t(cle, params) {
    const dictionnaire =
      (dictionnaires && dictionnaires[langueActuelle]) ||
      (dictionnaires && dictionnaires[langueParDefaut]) ||
      {};
    const brut = cle
      .split('.')
      .reduce(
        (acc, partie) =>
          acc && typeof acc === 'object' ? acc[partie] : undefined,
        dictionnaire
      );
    let texte = typeof brut === 'string' ? brut : cle;
    if (params) {
      for (const cleParam of Object.keys(params)) {
        texte = texte.split(`{${cleParam}}`).join(String(params[cleParam]));
      }
    }
    return texte;
  }

  /**
   * Retraduit tout le texte STATIQUE du HTML (aria-labels, titres, libellés
   * de boutons qui ne dépendent d'aucune donnée dynamique) via les attributs
   * data-i18n / data-i18n-title / data-i18n-aria-label / data-i18n-placeholder.
   * Les textes construits dynamiquement (messages, dialogues, toasts...)
   * sont eux traduits directement par l'appelant, dans les fonctions qui les
   * génèrent — ainsi que toute clé qui attend un paramètre (ex.
   * "channels.sendMessagePlaceholder", qui a besoin de {name} : voir
   * afficherMessages() dans renderer.js) : ce balayage appelle t() SANS
   * paramètres, donc une clé qui en attend un afficherait son placeholder
   * brut ("#{name}") si elle était posée ici via un attribut data-i18n-*.
   */
  function appliquerTraductionsStatiques() {
    global.document.documentElement.lang = langueActuelle;
    global.document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    global.document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.setAttribute('title', t(element.dataset.i18nTitle));
    });
    global.document
      .querySelectorAll('[data-i18n-aria-label]')
      .forEach((element) => {
        element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
      });
    global.document
      .querySelectorAll('[data-i18n-placeholder]')
      .forEach((element) => {
        element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
      });
  }

  /**
   * Traduit une erreur venant du processus main (via IPC) en texte lisible
   * dans la langue courante. Deux couches à défaire : (1) le préfixe
   * qu'Electron ajoute automatiquement à toute erreur IPC, et (2) le CODE
   * stable que MockGatewayRuntime lève (ex. "ERR_ACCES_REFUSE_SALON", ou
   * "ERR_PSEUDO_PRIS|alice" avec un paramètre) plutôt qu'un texte déjà en
   * français — la couche métier ne doit pas connaître la langue choisie par
   * l'utilisateur, donc la traduction se fait ici, à la frontière IPC/UI.
   *
   * Code non reconnu : on garde le texte brut plutôt qu'un message
   * générique. Différence assumée avec LoginPage.tsx (qui, lui, retombe sur
   * "errors.generic") : le dashboard et les messages privés sont l'outil de
   * test/démo (utilisateurs simulés, voir #current-user-select) où voir le
   * détail exact d'une erreur inattendue — y compris une erreur JS qui n'a
   * jamais été un CODE reconnu — aide à diagnostiquer plus vite qu'un
   * message vague, alors que l'écran de connexion est la première chose vue
   * par une personne qui n'a pas encore de raison de faire confiance à un
   * détail technique brut.
   */
  function messageErreur(erreur) {
    const brutAvecPrefixe =
      erreur instanceof Error ? erreur.message : String(erreur);
    const brut = brutAvecPrefixe.replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      ''
    );

    const [code, ...params] = brut.split('|');
    const cle = `errors.${code}`;
    const brutTraduit = t(cle);

    if (brutTraduit === cle) {
      return brut;
    }
    if (!params.length) return brutTraduit;
    // Convention "CODE|valeur" : un seul paramètre positionnel, dont le nom
    // (ex. "pseudo", "host"...) n'est pas connu d'ici — on le lit dans le
    // texte déjà traduit plutôt que de supposer qu'il s'appelle toujours
    // "pseudo", ce qui laisserait un futur {host} non substitué. On repasse
    // ensuite par t() (pas de .replace() manuel) pour la substitution.
    const nomParametre = brutTraduit.match(/\{(\w+)\}/)?.[1];
    return nomParametre ? t(cle, { [nomParametre]: params[0] }) : brutTraduit;
  }

  /**
   * Récupère dictionnaire, langue courante et langue par défaut auprès du
   * processus main EN PARALLÈLE (les trois canaux sont indépendants, aucun
   * n'a besoin du résultat d'un autre) puis met à jour l'état interne. À
   * appeler une fois au démarrage de chaque page (voir
   * renderer.js/message-prive.js). allSettled (plutôt que Promise.all) :
   * chaque échec est géré indépendamment, un canal qui échoue ne doit pas
   * empêcher les autres de s'appliquer.
   *
   * @param {object} electronAPI window.electronAPI (voir preload.js)
   * @returns {Promise<string>} la langue effectivement retenue (obtenirLangue())
   */
  async function initialiserDepuisElectronAPI(electronAPI) {
    const [resultatDictionnaires, resultatLangue, resultatLangueParDefaut] =
      await Promise.allSettled([
        electronAPI.obtenirDictionnairesI18n(),
        electronAPI.obtenirLangue(),
        electronAPI.obtenirLangueParDefaut(),
      ]);

    if (resultatDictionnaires.status === 'fulfilled') {
      dictionnaires = resultatDictionnaires.value;
    }
    // sinon, t() se rabat sur la clé brute si dictionnaires reste `null`.

    if (resultatLangueParDefaut.status === 'fulfilled') {
      langueParDefaut = resultatLangueParDefaut.value;
    }
    // sinon, repli sur 'fr' (valeur initiale, voir sa déclaration plus haut).

    if (resultatLangue.status === 'fulfilled') {
      langueActuelle = resultatLangue.value;
    } else {
      // Repli sur langueParDefaut (lui-même 'fr' si le canal ci-dessus a
      // aussi échoué) plutôt que rester sur la valeur initiale codée en dur.
      langueActuelle = langueParDefaut;
    }
    return langueActuelle;
  }

  function obtenirLangue() {
    return langueActuelle;
  }

  /** À appeler après un `electronAPI.obtenirLangue()`/`definirLangue()`
   * réussi, pour que t()/appliquerTraductionsStatiques() reflètent la
   * nouvelle langue. */
  function definirLangueActuelle(langue) {
    langueActuelle = langue;
  }

  global.I18n = {
    t,
    appliquerTraductionsStatiques,
    messageErreur,
    initialiserDepuisElectronAPI,
    obtenirLangue,
    definirLangueActuelle,
  };
})(window);
