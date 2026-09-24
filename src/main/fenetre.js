// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Fenêtre principale, navigation et barre de titre.
const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const {
  etat,
  isDev,
  logDebugNotif,
  envoyerVersRenderer,
} = require('./contexte');
const {
  RACINE,
  DEV_SERVER_PORT,
  APP_PAGES_ROOT,
  APP_INDEX_PATH,
  APP_LOGIN_PATH,
  isAppUrl,
  isPathInsideAppPages,
  exposerCanal,
  verifierProvenance,
} = require('./securite');

// Icône personnalisée de l'app (mascotte de la maquette), utilisée à la
// fois pour la fenêtre (barre des tâches/dock en dev) et comme base des
// icônes de build packagées séparément.
const APP_ICON_PATH = path.join(RACINE, 'assets', 'icon.png');

// Couleur de fond peinte avant que index.html ne soit chargé/affiché.
// Évite le flash de fenêtre blanche par défaut d'Electron au démarrage ;
// reprend la teinte sombre de la maquette (voir maquette/maquette_multi.pdf).
const WINDOW_BACKGROUND_COLOR = '#0d3d38';
// Fond natif de la fenêtre pour le thème clair (= --bg-panel de styles.css) :
// visible une fraction de seconde entre deux pages, il doit suivre le thème.
const WINDOW_BACKGROUND_COLOR_CLAIR = '#e3f6ef';

function couleurFondFenetre() {
  return etat.themeActuel === 'clair'
    ? WINDOW_BACKGROUND_COLOR_CLAIR
    : WINDOW_BACKGROUND_COLOR;
}

// Barre de titre personnalisée : hors macOS, la fenêtre est sans cadre
// (frame: false) — le cadre natif laissait une barre et un contour blancs
// sous Linux/WSLg. La bande glissable, avec le nom de l'app et les boutons
// réduire/agrandir/fermer (canaux 'fenetre:*' plus bas), est injectée par
// preload.js et stylée par styles.css / connexion.css (.app-titlebar).

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 600;

// Zoom adaptatif (voir createWindow) : 100 % jusqu'à la taille par défaut
// de la fenêtre, puis proportionnel à la taille de la fenêtre, plafonné.
// On prend le plus petit des deux rapports (largeur, hauteur) pour que la
// mise en page tienne toujours, et on arrondit par pas de 5 % pour éviter
// que le texte « tremble » pendant un redimensionnement.
const ZOOM_ADAPTATIF_MAX = 1.35;

function facteurZoomAdaptatif(largeur, hauteur) {
  const rapport = Math.min(
    largeur / DEFAULT_WINDOW_WIDTH,
    hauteur / DEFAULT_WINDOW_HEIGHT
  );
  const borne = Math.min(Math.max(rapport, 1), ZOOM_ADAPTATIF_MAX);
  return Math.round(borne * 20) / 20;
}

function appliquerZoomAdaptatif(win) {
  if (win.isDestroyed()) return;
  const [largeur, hauteur] = win.getContentSize();
  const facteur = facteurZoomAdaptatif(largeur, hauteur);
  if (win.webContents.getZoomFactor() !== facteur) {
    win.webContents.setZoomFactor(facteur);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    center: true,
    show: false, // affichée seulement une fois prête (voir 'ready-to-show' plus bas)
    backgroundColor: couleurFondFenetre(),
    // Barre de menu masquée par défaut (Alt pour l'afficher sur
    // Windows/Linux) : notre menu applicatif (buildMenu) reste actif et
    // accessible, mais n'est pas imposé visuellement — élément Electron
    // "non désiré" en moins dans l'interface par défaut.
    autoHideMenuBar: true,
    // macOS garde ses propres boutons (feux tricolores) ; ailleurs, fenêtre
    // sans cadre et boutons dessinés par la page (voir preload.js).
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' }
      : { frame: false }),
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(RACINE, 'preload.js'),
      contextIsolation: true, // isole le contexte JS du preload de celui de la page web
      nodeIntegration: false, // aucun accès Node.js direct dans le renderer
      sandbox: true, // renderer exécuté dans un processus restreint (recommandé par Electron)
      webviewTag: false, // pas de balise <webview> (surface d'attaque supplémentaire)
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  // Affiche la fenêtre seulement quand son contenu est prêt à être peint,
  // pour éviter le flash de fenêtre blanche vide typique d'Electron.
  win.once('ready-to-show', () => {
    win.show();
  });

  // Voir le commentaire sur fenetreEstFocusee plus haut : ces logs de
  // diagnostic permettent de confirmer, dans le terminal npm start, si ces
  // événements de minimisation sont bel et bien émis sous WSLg (ils ne le
  // sont pas dans les faits — voir plus bas — mais restent utiles pour
  // diagnostiquer un jour un souci équivalent sur une vraie installation).
  win.on('minimize', () => {
    logDebugNotif('[fenetre] minimize');
  });
  win.on('restore', () => {
    logDebugNotif('[fenetre] restore');
  });
  win.on('focus', () => {
    // Arrête le clignotement éventuel du repli de notification.
    win.flashFrame(false);
    etat.fenetreEstFocusee = true;
    logDebugNotif('[fenetre] focus');
    // Voir 'window:focus-changed' plus bas : le renderer a besoin de ce
    // signal pour ne marquer une conversation comme "lue" (NotifPrefs.
    // marquerCommeLu) que si la fenêtre a réellement le focus au moment où
    // elle est affichée — sinon un message reçu pendant que la fenêtre est
    // en arrière-plan se retrouverait marqué "lu" côté rond de notification
    // alors même qu'une vraie notification système vient d'être déclenchée
    // pour ce même message (voir showMessageNotification, qui se base déjà
    // sur fenetreEstFocusee pour la même raison).
    envoyerVersRenderer('window:focus-changed', true);
  });
  win.on('blur', () => {
    etat.fenetreEstFocusee = false;
    logDebugNotif('[fenetre] blur');
    envoyerVersRenderer('window:focus-changed', false);
  });
  // Piste de secours : sous WSLg, le bouton de réduction natif ne semble
  // déclencher ni 'minimize' ni changer isMinimized()/isFocused() — peut-être
  // que WSLg traduit ça par 'hide' plutôt que par une vraie minimisation.
  // Log de diagnostic ajouté pour vérifier ; si rien de tout ça ne se
  // déclenche non plus, c'est très probablement une limite de WSLg qu'on ne
  // peut pas contourner depuis le code de l'app (voir avertirSiWSL()). Confirmé
  // sans appel : aucun de ces événements ('minimize'/'restore'/'hide'/'show')
  // ne se déclenche jamais sous cet environnement — seuls 'focus'/'blur'
  // (voir plus haut) réagissent, d'où l'abandon complet de la minimisation
  // comme signal de suppression des notifications (voir showMessageNotification).
  // Icône du bouton agrandir/restaurer de la barre de titre (preload.js).
  win.on('maximize', () => envoyerVersRenderer('fenetre:maximisee', true));
  win.on('unmaximize', () =>
    envoyerVersRenderer('fenetre:maximisee', fenetreEstAgrandie())
  );
  win.on('hide', () => {
    logDebugNotif('[fenetre] hide');
  });
  win.on('show', () => {
    logDebugNotif('[fenetre] show');
  });

  // Désactive le zoom Chromium par défaut (Ctrl+molette, pincement) : pas
  // pertinent pour cette application de bureau et pas prévu dans la maquette.
  win.webContents.setVisualZoomLevelLimits(1, 1);

  // Zoom adaptatif : l'interface grandit avec la fenêtre (agrandie, grand
  // écran) au lieu de laisser de grands vides. Réappliqué à chaque
  // chargement de page, le zoom Chromium n'étant pas conservé d'une page à
  // l'autre de façon fiable.
  let delaiZoom = null;
  win.on('resize', () => {
    clearTimeout(delaiZoom);
    delaiZoom = setTimeout(() => appliquerZoomAdaptatif(win), 60);
  });
  win.webContents.on('did-finish-load', () => appliquerZoomAdaptatif(win));

  // DevTools jamais ouverts automatiquement en production.
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Le menu ne propose déjà plus l'accès aux DevTools en production (voir
    // buildMenu). Les raccourcis clavier Chromium restants (F12 partout,
    // Ctrl+Shift+I/J/C sur Windows/Linux, Cmd+Option+I/J/C sur macOS) restent
    // actifs par défaut indépendamment du menu : on réduit la surface en les
    // interceptant ici. Ce n'est pas une vraie barrière de sécurité (rien
    // n'empêche d'ouvrir les DevTools via --remote-debugging-port ou un
    // build modifié) — contextIsolation/sandbox/CSP sont ce qui protège
    // réellement ; ceci évite seulement un accès accidentel au clavier.
    const devToolsKeys = new Set(['I', 'J', 'C']);
    win.webContents.on('before-input-event', (event, input) => {
      // Windows/Linux : Ctrl+Shift+<touche>. macOS : Cmd+Option+<touche>
      // (pas Cmd+Shift, qui est un raccourci différent sous Chromium).
      const modifierPressed =
        (input.control && input.shift) || (input.meta && input.alt);
      const isDevToolsShortcut =
        input.key === 'F12' ||
        (modifierPressed && devToolsKeys.has(input.key.toUpperCase()));
      if (isDevToolsShortcut) {
        event.preventDefault();
      }
    });
  }

  // --- Navigation contrôlée ------------------------------------------------
  // Empêche le renderer de naviguer ailleurs que dans l'app (protection
  // contre une redirection malveillante si un lien externe finissait dans le DOM).
  // Comparaison structurée via isAppUrl() : file:// n'autorise que le point
  // d'entrée de l'app (pas n'importe quel fichier local), et http://localhost
  // n'autorise que le hostname + port exacts du serveur de dev, en dev
  // uniquement — jamais un simple prefix-match sur la chaîne d'URL brute.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  });

  // Bloque l'ouverture de nouvelles fenêtres (window.open, target=_blank...),
  // et redirige les liens http(s) légitimes vers le navigateur système plutôt
  // que de créer une nouvelle fenêtre Electron non contrôlée.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Le comportement de fermeture (window-all-closed / activate ci-dessous)
  // et la relance depuis une deuxième instance (second-instance) dépendent
  // de cette référence : on l'efface quand la fenêtre est réellement fermée
  // pour ne jamais agir sur une fenêtre détruite.
  win.on('closed', () => {
    if (etat.mainWindow === win) {
      etat.mainWindow = null;
    }
  });

  // La page de connexion est chargée en premier ; c'est elle qui, une fois
  // la session locale établie, demande la navigation vers le dashboard via
  // le canal IPC 'navigation:tableau-de-bord' (voir plus bas) plutôt qu'une
  // navigation directe côté renderer. En dev, on pointe vers le serveur Vite
  // (Fast Refresh) ; en prod, vers le bundle buildé dans dist/login.
  if (isDev) {
    win.loadURL(`http://localhost:${DEV_SERVER_PORT}/`);
  } else {
    win.loadFile(APP_LOGIN_PATH);
  }

  return win;
}

// 'navigation:tableau-de-bord' : appelé par la page de connexion une fois la
// session locale établie (voir LoginPage.tsx). On revalide la provenance de
// l'appel via isAppUrl(event.senderFrame.url) avant d'agir dessus — un appel
// IPC provenant d'une page non reconnue est silencieusement ignoré plutôt
// que d'entraîner une navigation.
//
// Volontairement différent de exposerCanal()/verifierProvenance() (qui
// lèvent sur une origine invalide) : ce canal est invoqué automatiquement
// par LoginPage juste après une connexion réussie, jamais suite à une
// action utilisateur explicite sur laquelle afficher une erreur. Lever ici
// ne ferait que produire un rejet de promesse non géré côté renderer sans
// bénéfice de sécurité additionnel (la navigation elle-même reste bloquée) ;
// ignorer silencieusement est donc le comportement voulu, pas un oubli.
ipcMain.handle('navigation:tableau-de-bord', (event) => {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) {
    return;
  }
  if (etat.mainWindow) {
    etat.mainWindow.loadFile(APP_INDEX_PATH);
  }
});

// 'navigation:connexion' : symétrique de 'navigation:tableau-de-bord'
// ci-dessus, dans l'autre sens — appelé par le dashboard (voir renderer.js/
// message-prive.js, bouton "Se déconnecter") une fois la session fermée côté
// gateway (chatGateway.deconnexion(), voir 'session:deconnexion' plus bas),
// pour ramener la fenêtre à l'écran de connexion. Reprend exactement la même
// logique dev/prod que le tout premier chargement dans createWindow() : en
// dev, la page de connexion est servie par le serveur Vite (Fast Refresh),
// jamais par un fichier sous APP_PAGES_ROOT ; en prod, c'est le bundle buildé
// (APP_LOGIN_PATH), qui vit délibérément hors de cet arbre (voir isAppUrl()
// plus haut pour pourquoi ce chemin précis est reconnu comme interne à
// l'app).
function afficherPageConnexion() {
  if (!etat.mainWindow || etat.mainWindow.isDestroyed()) {
    return;
  }
  if (isDev) {
    etat.mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}/`);
  } else {
    etat.mainWindow.loadFile(APP_LOGIN_PATH);
  }
}

ipcMain.handle('navigation:connexion', (event) => {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) {
    return;
  }
  afficherPageConnexion();
});

// --- Boutons de la barre de titre (fenêtre sans cadre, voir preload.js) ------
// Agrandir/restaurer est fait à la main (bornes = zone de travail de
// l'écran) plutôt qu'avec maximize()/unmaximize() : sous WSLg, une fenêtre
// sans cadre agrandie par le gestionnaire de fenêtres ne se restaure pas
// correctement, et isMaximized()/'unmaximize' n'y sont pas fiables (même
// limite que 'minimize', voir createWindow).
let bornesAvantAgrandissement = null;

function fenetreEstAgrandie() {
  return bornesAvantAgrandissement !== null || !!etat.mainWindow?.isMaximized();
}

function basculerAgrandissement() {
  if (!etat.mainWindow || etat.mainWindow.isDestroyed()) return false;
  if (etat.mainWindow.isMaximized()) {
    etat.mainWindow.unmaximize();
  } else if (bornesAvantAgrandissement) {
    etat.mainWindow.setBounds(bornesAvantAgrandissement);
    bornesAvantAgrandissement = null;
  } else {
    bornesAvantAgrandissement = etat.mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bornesAvantAgrandissement);
    etat.mainWindow.setBounds(workArea);
  }
  const agrandie = fenetreEstAgrandie();
  envoyerVersRenderer('fenetre:maximisee', agrandie);
  return agrandie;
}

exposerCanal('fenetre:reduire', () => etat.mainWindow?.minimize());
exposerCanal('fenetre:agrandir', () => basculerAgrandissement());
exposerCanal('fenetre:fermer', () => etat.mainWindow?.close());
exposerCanal('fenetre:est-maximisee', () => fenetreEstAgrandie());

ipcMain.handle('navigate', (event, page) => {
  verifierProvenance(event);
  const pagePath = path.resolve(APP_PAGES_ROOT, page ?? '');
  if (!isPathInsideAppPages(pagePath)) {
    throw new Error('Page de navigation invalide');
  }
  return BrowserWindow.fromWebContents(event.sender)?.loadFile(pagePath);
});

module.exports = {
  APP_ICON_PATH,
  couleurFondFenetre,
  facteurZoomAdaptatif,
  createWindow,
  afficherPageConnexion,
  fenetreEstAgrandie,
};
