const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

// Port du serveur de dev local (ex. Vite) : mettre à jour ici s'il change,
// plutôt que d'accepter n'importe quel port sur localhost.
const DEV_SERVER_PORT = '5173';

// Chemin absolu du point d'entrée de l'app, utilisé pour vérifier qu'une
// navigation file:// reste bien à l'intérieur du bundle (et non, par ex.,
// file:///etc/passwd ou un autre fichier arbitraire du disque).
const APP_INDEX_PATH = path.resolve(__dirname, 'index.html');

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
    return filePath === APP_INDEX_PATH;
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

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    // TODO(assets): remplacer par l'icône réelle de l'app avant release
    // (voir issue à créer) ; en son absence Electron retombe silencieusement
    // sur une icône par défaut, donc rien ne casse mais ça ne doit pas être
    // oublié avant le packaging final.
    icon: path.join(__dirname, 'assets', 'icon.png'),
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

  // DevTools jamais ouverts automatiquement en production.
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
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

  win.loadFile('index.html');

  return win;
}

// --- IPC : API contrôlée côté Main ------------------------------------------
// Chaque canal est déclaré explicitement ici ; le renderer n'a jamais accès
// à ipcRenderer directement (voir preload.js), seulement à ces méthodes.
// Exemple minimal ping/pong pour valider que le canal contrôlé fonctionne
// de bout en bout. La logique de chat (salons, messages, DM...) viendra
// dans une tâche séparée et suivra le même principe (canaux nommés, jamais
// de passthrough générique) — et devra, comme ici, valider la provenance de
// chaque message avant d'agir dessus.
ipcMain.on('ping', (event) => {
  // Validation de la frame émettrice : refuse tout message venant d'un
  // contexte qui ne serait pas notre propre fenêtre/app (ex. une frame
  // file:// ou http:// inattendue qui aurait été chargée par erreur). Cette
  // vérification est le complément naturel de l'allow-list de canaux : sans
  // elle, n'importe quelle frame pourrait déclencher le handler du moment
  // qu'elle connaît le nom du canal.
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || !isAppUrl(senderUrl)) {
    return;
  }
  event.sender.send('pong', 'pong depuis le processus Main');
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Défense en profondeur : avec webviewTag: false déjà positionné dans
// webPreferences (ci-dessus), <webview> ne peut de toute façon pas être
// instanciée, donc cet événement ne devrait jamais se déclencher en
// pratique. On le garde en ceinture-et-bretelles au cas où webviewTag
// serait un jour réactivé par erreur, mais ce n'est pas lui qui complète
// setWindowOpenHandler — c'est bien webviewTag: false qui fait le travail.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
