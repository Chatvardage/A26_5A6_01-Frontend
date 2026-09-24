// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Préférences (thème, langue, notifications, profil public).
const { Menu } = require('electron');
const { LANGUE_PAR_DEFAUT, LANGUES_SUPPORTEES } = require('../i18n/i18n.js');
const translations = require('../i18n/translations.json');
const {
  etat,
  THEME_PAR_DEFAUT,
  THEMES_SUPPORTEES,
  MODES_NOTIFICATION,
} = require('./contexte');
const { chatGateway } = require('./gateway');
const { exposerCanal } = require('./securite');
const { buildMenu } = require('./menu');
const { couleurFondFenetre } = require('./fenetre');

// --- Préférences synchronisées ------------------------------------------------
function preferencesCourantes() {
  return {
    theme: etat.themeActuel,
    langue: etat.langueActuelle,
    modeNotification: etat.modeNotificationActuel,
    alias: etat.aliasActuel,
    avatar: etat.avatarActuel,
  };
}

function diffuserPreferences() {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send(
      'preferences:change',
      preferencesCourantes()
    );
  }
}

/** Met à jour la copie locale (valeurs invalides ignorées) et prévient la
 * fenêtre. `donnees` peut être partiel. */
function appliquerPreferencesLocales(donnees) {
  if (THEMES_SUPPORTEES.includes(donnees.theme)) {
    etat.themeActuel = donnees.theme;
    if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
      etat.mainWindow.setBackgroundColor(couleurFondFenetre());
    }
  }
  if (
    LANGUES_SUPPORTEES.includes(donnees.langue) &&
    donnees.langue !== etat.langueActuelle
  ) {
    etat.langueActuelle = donnees.langue;
    Menu.setApplicationMenu(buildMenu());
  }
  if (MODES_NOTIFICATION.includes(donnees.modeNotification)) {
    etat.modeNotificationActuel = donnees.modeNotification;
  }
  if ('alias' in donnees) etat.aliasActuel = donnees.alias || null;
  if ('avatar' in donnees) etat.avatarActuel = donnees.avatar || null;
  diffuserPreferences();
  return preferencesCourantes();
}

async function synchroniserPreferencesDepuisServeur() {
  try {
    appliquerPreferencesLocales(await chatGateway.configObtenir());
  } catch (erreur) {
    console.error(
      '[preferences] chargement depuis le serveur impossible :',
      erreur
    );
  }
}

async function apresOuvertureSession(resultat) {
  if (resultat) {
    // Charger ses serveurs inscrit l'utilisateur au serveur par défaut
    // « Chatvardage » (voir Room-Service, listerMesServeurs) : fait dès
    // l'ouverture de session, donc dès l'inscription, sans attendre la page
    // des salons (écran « Choisis ton pseudo », app quittée avant…). En
    // arrière-plan : un échec ne doit pas bloquer la connexion, la page des
    // salons refera l'appel.
    chatGateway.chargerServeurs().catch((erreur) => {
      console.error('[serveurs] inscription au serveur par défaut :', erreur);
    });
    await synchroniserPreferencesDepuisServeur();
  }
  return resultat;
}

/**
 * Connexion/inscription explicites : si une langue a été choisie sur l'écran
 * de connexion (`langue`, capturée AVANT l'appel, voir
 * langueChoisieAvantConnexion), elle prime sur celle du profil et y est
 * sauvegardée, au lieu d'être écrasée par synchroniserPreferencesDepuisServeur.
 * Sans choix explicite (`langue` null), la langue du profil s'applique. La
 * reprise de session (jeton persisté) garde, elle aussi, la langue du profil.
 */
function apresOuvertureSessionAvecLangueChoisie(langue) {
  return async (resultat) => {
    await apresOuvertureSession(resultat);
    if (resultat) etat.langueChoisieAvantConnexion = null;
    if (resultat && LANGUES_SUPPORTEES.includes(langue)) {
      try {
        await enregistrerPreferences({ langue });
      } catch (erreur) {
        appliquerPreferencesLocales({ langue });
        console.error('[preferences] enregistrement de la langue :', erreur);
      }
    }
    return resultat;
  };
}

/** Enregistre sur le serveur (si connecté) puis applique la réponse. */
async function enregistrerPreferences(donnees) {
  if (!chatGateway.obtenirUtilisateurConnecte()) {
    return appliquerPreferencesLocales(donnees);
  }
  return appliquerPreferencesLocales(await chatGateway.configModifier(donnees));
}

/** Pour les sélecteurs rapides (thème/langue) : effet local immédiat,
 * enregistrement serveur au mieux, sans bloquer l'UI. */
function persisterPreferenceEnArrierePlan(donnees) {
  if (!chatGateway.obtenirUtilisateurConnecte()) return;
  chatGateway.configModifier(donnees).catch((erreur) => {
    console.error('[preferences] enregistrement impossible :', erreur);
  });
}

// --- Configuration utilisateur (alias, thème, langue, notifications) --------
// Source de vérité : User-Config-Service. main.js en garde une copie
// (themeActuel, langueActuelle, modeNotificationActuel, aliasActuel), chargée
// à l'ouverture de session et diffusée à la fenêtre via 'preferences:change'
// à chaque modification, pour que toutes les pages s'y alignent en direct.
exposerCanal('config:obtenir', () => chatGateway.configObtenir());
exposerCanal('config:modifier', async (donnees) => {
  const config = await chatGateway.configModifier(donnees);
  appliquerPreferencesLocales(config);
  return config;
});
exposerCanal('preferences:obtenir', () => preferencesCourantes());
exposerCanal('preferences:modifier', (donnees) =>
  enregistrerPreferences(donnees)
);

// --- Langue (i18n) -------------------------------------------------------
// 'langue:obtenir' : lue par la page de connexion et le dashboard au
// démarrage pour afficher la bonne langue dès le premier rendu.
// 'langue:definir' : appelée quand l'utilisateur change de langue (voir le
// sélecteur dans LoginPage.tsx / renderer.js). Reconstruit aussi le menu
// natif immédiatement, sans redémarrer l'app.
// 'i18n:dictionnaires' : le dashboard (renderer.js) n'a pas accès à
// require() (nodeIntegration: false, comme il se doit) donc ne peut pas
// charger translations.json lui-même ; ce canal lui fournit tout le
// dictionnaire (fr + en) EN UNE FOIS au démarrage, mis en cache côté
// renderer, plutôt qu'un aller-retour IPC par traduction.
exposerCanal('langue:obtenir', () => etat.langueActuelle);
exposerCanal('langue:definir', ({ langue }) => {
  if (LANGUES_SUPPORTEES.includes(langue)) {
    if (!chatGateway.obtenirUtilisateurConnecte()) {
      etat.langueChoisieAvantConnexion = langue;
    }
    appliquerPreferencesLocales({ langue });
    persisterPreferenceEnArrierePlan({ langue });
  }
  return etat.langueActuelle;
});
exposerCanal('i18n:dictionnaires', () => translations);
// Permet à renderer.js/message-prive.js (pas de require(), voir plus haut)
// de dériver leur propre repli initial de LA MÊME constante que le reste de
// l'app, plutôt que de recopier 'fr' en dur indépendamment dans chaque
// fichier — évite une dérive silencieuse si LANGUE_PAR_DEFAUT change un jour.
exposerCanal('i18n:langue-par-defaut', () => LANGUE_PAR_DEFAUT);

// --- Thème (clair/sombre) -------------------------------------------------
// Même principe que la langue ci-dessus : état unique côté main, partagé
// entre la page de connexion et le dashboard/messages privés. Avant
// connexion, c'est un simple choix local ; une fois connecté, il est chargé
// depuis le serveur et toute modification y est enregistrée (voir
// "Préférences synchronisées" plus bas).
exposerCanal('theme:obtenir', () => etat.themeActuel);
exposerCanal('theme:definir', ({ theme }) => {
  if (THEMES_SUPPORTEES.includes(theme)) {
    appliquerPreferencesLocales({ theme });
    persisterPreferenceEnArrierePlan({ theme });
  }
  return etat.themeActuel;
});
exposerCanal('theme:par-defaut', () => THEME_PAR_DEFAUT);

module.exports = {
  preferencesCourantes,
  appliquerPreferencesLocales,
  apresOuvertureSession,
  apresOuvertureSessionAvecLangueChoisie,
};
