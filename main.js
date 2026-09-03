const {
  app,
  BrowserWindow,
  Menu,
  shell,
  ipcMain,
  session,
} = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

// Port du serveur de dev local (ex. Vite) : mettre à jour ici s'il change,
// plutôt que d'accepter n'importe quel port sur localhost.
const DEV_SERVER_PORT = '5173';

// URL du serveur de dev Vite pour la page de connexion (voir vite.config.mts,
// root = src/presentation/pages/login). En développement, c'est la première
// page chargée par la fenêtre (voir createWindow) ; en production, la
// version buildée (APP_LOGIN_PATH) est utilisée à la place.
const DEV_LOGIN_URL = `http://localhost:${DEV_SERVER_PORT}/`;

// Chemin absolu du dashboard (post-connexion), utilisé pour vérifier qu'une
// navigation file:// reste bien à l'intérieur du bundle (et non, par ex.,
// file:///etc/passwd ou un autre fichier arbitraire du disque).
const APP_INDEX_PATH = path.resolve(
    __dirname,
    'src',
    'presentation',
    'pages',
    'index.html'
);

// Chemin absolu de la page de connexion buildée par Vite (voir
// `npm run build:login` / vite.config.mts). C'est la première page chargée
// par la fenêtre en production (voir createWindow).
const APP_LOGIN_PATH = path.resolve(__dirname, 'dist', 'login', 'index.html');

// Chemins file:// autorisés par isAppUrl (voir plus bas) : le dashboard et
// la page de connexion, et rien d'autre.
const ALLOWED_FILE_PATHS = new Set([APP_INDEX_PATH, APP_LOGIN_PATH]);

// Icône personnalisée de l'app (mascotte de la maquette), utilisée à la
// fois pour la fenêtre (barre des tâches/dock en dev) et comme base des
// icônes de build packagées séparément.
const APP_ICON_PATH = path.join(__dirname, 'assets', 'icon.png');

// Couleur de fond peinte avant que index.html ne soit chargé/affiché.
// Évite le flash de fenêtre blanche par défaut d'Electron au démarrage ;
// reprend la teinte sombre de la maquette (voir maquette/maquette_multi.pdf).
const WINDOW_BACKGROUND_COLOR = '#0d3d38';

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;
const MIN_WINDOW_WIDTH = 960;
const MIN_WINDOW_HEIGHT = 600;

// --- Vérification structurée d'une URL "interne à l'app" --------------------
// Utilisée à la fois pour le garde-fou de navigation (will-navigate) et pour
// la validation de l'origine des messages IPC entrants. On parse l'URL et on
// compare des champs structurés (protocol/hostname/port/pathname) plutôt que
// de faire un simple `startsWith` sur la chaîne brute, qui peut être trompé
// par un préfixe ("http://localhost.evil.com") ou un chemin quelconque
// ("file:///home/user/.ssh/id_rsa").
function isAppUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === 'file:') {
    let filePath;
    try {
      filePath = path.resolve(decodeURIComponent(parsed.pathname));
    } catch {
      return false;
    }
    return ALLOWED_FILE_PATHS.has(filePath);
  }

  // Le serveur de dev local n'est autorisé qu'en développement, et seulement
  // sur le hostname et le port attendus (comparaison structurée, pas un
  // prefix-match qui matcherait aussi "localhost.evil.com").
  if (isDev && parsed.protocol === 'http:') {
    return parsed.hostname === 'localhost' && parsed.port === DEV_SERVER_PORT;
  }

  return false;
}

// --- Menu applicatif minimal et maîtrisé -----------------------------------
// L'énoncé interdit les menus par défaut non contrôlés en production.
// On construit ici un menu volontairement réduit (pas d'onglets Node/Debug
// exposés en production).
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
        ? [{ label: app.getName(), submenu: [{ role: 'quit' }] }]
        : []),
    {
      label: 'Fichier',
      submenu: [
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Édition',
      submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    // DevTools uniquement en développement : jamais exposé en production.
    ...(isDev
        ? [
          {
            label: 'Développement',
            submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }],
          },
        ]
        : []),
  ];
  return Menu.buildFromTemplate(template);
}

// Référence vers la fenêtre principale, utilisée par le verrou d'instance
// unique (second-instance) et par 'activate' pour savoir si une fenêtre
// existe déjà plutôt que de se fier uniquement à getAllWindows().
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    center: true,
    show: false, // affichée seulement une fois prête (voir 'ready-to-show' plus bas)
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    // Barre de menu masquée par défaut (Alt pour l'afficher sur
    // Windows/Linux) : notre menu applicatif (buildMenu) reste actif et
    // accessible, mais n'est pas imposé visuellement — élément Electron
    // "non désiré" en moins dans l'interface par défaut.
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
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

  // Désactive le zoom Chromium par défaut (Ctrl+molette, pincement) : pas
  // pertinent pour cette application de bureau et pas prévu dans la maquette.
  win.webContents.setVisualZoomLevelLimits(1, 1);

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
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  // La page de connexion est chargée en premier (voir README > Architecture
  // et le commentaire en tête de src/presentation/pages/index.html) ; c'est
  // elle qui, une fois la session locale établie, demande la navigation
  // vers le dashboard via le canal IPC 'navigation:tableau-de-bord' (voir
  // plus bas) plutôt qu'une navigation directe côté renderer.
  if (isDev) {
    win.loadURL(DEV_LOGIN_URL);
  } else {
    win.loadFile(APP_LOGIN_PATH);
  }

  return win;
}

// --- IPC : API contrôlée côté Main ------------------------------------------
// Chaque canal est déclaré explicitement ici ; le renderer n'a jamais accès
// à ipcRenderer directement (voir preload.js), seulement à ce que preload.js
// expose sur window.electronAPI.
//
// 'navigation:tableau-de-bord' : appelé par la page de connexion une fois la
// session locale établie (voir LoginPage.tsx). On revalide la provenance de
// l'appel via isAppUrl(event.senderFrame.url) avant d'agir dessus — un appel
// IPC provenant d'une page non reconnue (ex. une injection de contenu
// distant) est silencieusement ignoré plutôt que d'entraîner une navigation.
// Le premier canal métier réel (ChatGateway : salons, messages, DM...)
// suivra le même principe.
ipcMain.handle('navigation:tableau-de-bord', (event) => {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) {
    return;
  }
  if (mainWindow) {
    mainWindow.loadFile(APP_INDEX_PATH);
  }
});

// --- Content-Security-Policy de la page de connexion (dev vs prod) --------
// Appliquée via en-tête HTTP plutôt que balise <meta> dans index.html (voir
// le commentaire dans src/presentation/pages/login/index.html) : la CSP
// diffère entre dev et prod, ce qu'une seule balise statique ne peut pas
// exprimer.
//
// - Dev : le plugin React de Vite injecte un <script type="module"> INLINE
//   au tout début de <head> pour amorcer le Fast Refresh (React Refresh
//   runtime) ; 'unsafe-inline' est nécessaire pour script-src en dev
//   uniquement, sinon ce script est bloqué (échec silencieux au chargement).
//   connect-src autorise aussi le WebSocket du serveur de dev (HMR).
// - Prod : le bundle buildé par Vite (`npm run build:login`) ne contient
//   aucun script inline (voir dist/login/index.html), donc CSP stricte,
//   identique à celle du dashboard.
//
// Le filtre `isLoginPageRequest` limite l'en-tête à l'origine de la page de
// connexion (serveur de dev en dev, dossier dist/login en prod) pour ne pas
// affecter le dashboard, qui garde sa propre balise <meta> CSP inchangée.
function configurerCsp() {
  const cspDev =
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      'font-src https://fonts.gstatic.com; ' +
      "img-src 'self' data:; " +
      `connect-src 'self' http://localhost:${DEV_SERVER_PORT} ws://localhost:${DEV_SERVER_PORT};`;

  const cspProd =
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      'font-src https://fonts.gstatic.com; ' +
      "img-src 'self' data:;";

  const devOrigin = `http://localhost:${DEV_SERVER_PORT}/`;
  const prodLoginPrefix = `file://${APP_LOGIN_PATH.replace(/\\/g, '/')}`;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isLoginPageRequest = isDev
        ? details.url.startsWith(devOrigin)
        : details.url.startsWith(prodLoginPrefix);

    if (!isLoginPageRequest) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? cspDev : cspProd],
      },
    });
  });
}

// --- Instance unique ---------------------------------------------------
// Une appli de clavardage locale n'a pas de sens ouverte deux fois en
// parallèle (deux fenêtres se disputeraient la même session/persistance
// locale). Si une deuxième instance est lancée, on la ferme immédiatement
// et on redonne le focus à la fenêtre existante plutôt que de laisser
// cohabiter deux processus.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    configurerCsp();
    mainWindow = createWindow();

    app.on('activate', () => {
      // Comportement standard macOS : l'app reste active dans le dock après
      // la fermeture de toutes les fenêtres, et on en recrée une au clic.
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    // Sur macOS, une app reste active sans fenêtre ouverte (convention de
    // plateforme) ; ailleurs, fermer la dernière fenêtre ferme l'app.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

// Défense en profondeur : avec webviewTag: false déjà positionné dans
// webPreferences (ci-dessus), <webview> ne peut de toute façon pas être
// instanciée, donc cet événement ne devrait jamais se déclencher en
// pratique. On le garde en ceinture-et-bretelles au cas où webviewTag
// serait un jour réactivé par erreur, mais ce n'est pas lui qui complète
// setWindowOpenHandler — c'est bien webviewTag: false qui fait le travail.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
