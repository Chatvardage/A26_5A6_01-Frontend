const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');

function registerTypeScriptLoader() {
  if (require.extensions['.ts']) {
    return;
  }

  require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });

    module._compile(transpiled.outputText, filename);
  };

  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
    try {
      return originalResolveFilename.call(this, request, parent, isMain, options);
    } catch (error) {
      if (!request.endsWith('.js')) {
        throw error;
      }

      const tsRequest = request.slice(0, -3) + '.ts';
      try {
        return originalResolveFilename.call(this, tsRequest, parent, isMain, options);
      } catch {
        throw error;
      }
    }
  };
}

registerTypeScriptLoader();

const { creerMockGateway } = require('./src/infrastructure/gateways/MockGateway.ts');

const isDev = process.env.NODE_ENV === 'development';
const CURRENT_USER_ID = 'u1';
const mockGateway = creerMockGateway(10);
let privateConversationsReady = false;

// Port du serveur de dev local (ex. Vite) : mettre à jour ici s'il change,
// plutôt que d'accepter n'importe quel port sur localhost.
const DEV_SERVER_PORT = '5173';

// Chemin absolu du point d'entrée de l'app, utilisé pour vérifier qu'une
// navigation file:// reste bien à l'intérieur du bundle (et non, par ex.,
// file:///etc/passwd ou un autre fichier arbitraire du disque).
const APP_INDEX_PATH = path.resolve(
  __dirname,
  'src',
  'presentation',
  'pages',
  'index.html'
);

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

function serializeMessage(message) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    auteurId: message.auteurId,
    contenu: message.contenu,
    type: message.type,
    envoi: message.envoi,
    modification: message.modification,
  };
}

async function initialiserConversationsPriveesMock() {
  if (privateConversationsReady) {
    return;
  }

  const seeds = [
    {
      userA: 'u1',
      userB: 'u2',
      messages: [
        { auteurId: 'u1', contenu: 'Salut ! On se voit ce soir ?' },
        { auteurId: 'u2', contenu: 'Oui, vers 20h, ça marche.' },
      ],
    },
    {
      userA: 'u1',
      userB: 'u3',
      messages: [
        { auteurId: 'u3', contenu: 'Tu as vu le dernier sprint ?' },
        { auteurId: 'u1', contenu: 'Oui, je le valide demain.' },
      ],
    },
    {
      userA: 'u2',
      userB: 'u3',
      messages: [
        { auteurId: 'u2', contenu: 'Jai envoyé les notes.' },
        { auteurId: 'u3', contenu: 'Merci, je les regarde.' },
      ],
    },
  ];

  for (const seed of seeds) {
    const conversationId = [seed.userA, seed.userB].sort().join(':');
    const conversation = await mockGateway.creerConversationPrivee(
      seed.userA,
      seed.userB
    );
    if (conversation.id !== conversationId) {
      continue;
    }

    for (const messageSeed of seed.messages) {
      await mockGateway.envoyerMessage(
        conversation.id,
        messageSeed.auteurId,
        messageSeed.contenu
      );
    }
  }

  privateConversationsReady = true;
}

async function obtenirConversationsPriveesPourUI() {
  await initialiserConversationsPriveesMock();

  const utilisateurs = await mockGateway.obtenirTousLesUtilisateurs();
  const byId = new Map(utilisateurs.map((user) => [user.id, user]));
  const conversations = [];

  for (let index = 0; index < utilisateurs.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < utilisateurs.length; otherIndex += 1) {
      const a = utilisateurs[index].id;
      const b = utilisateurs[otherIndex].id;
      const id = [a, b].sort().join(':');
      const conversation = await mockGateway.obtenirConversationPrivee(id);
      if (!conversation) {
        continue;
      }

      const otherUserId = conversation.participantIds.find(
        (participantId) => participantId !== CURRENT_USER_ID
      );
      const otherUser = otherUserId ? byId.get(otherUserId) : undefined;
      const presence = otherUserId ? await mockGateway.obtenirPresence(otherUserId) : undefined;
      const messages = (await mockGateway.obtenirMessagesConversation(conversation.id))
        .slice()
        .sort((first, second) => first.envoi - second.envoi)
        .map(serializeMessage);

      conversations.push({
        id: conversation.id,
        participantIds: [...conversation.participantIds],
        users: conversation.participantIds.map((participantId) => ({
          id: participantId,
          pseudo: byId.get(participantId)?.pseudo ?? participantId,
        })),
        otherUser: otherUser
          ? {
              id: otherUser.id,
              pseudo: otherUser.pseudo,
              present: presence?.statut === 'en-ligne',
            }
          : null,
        lastMessage: messages.at(-1) ?? null,
        messages,
      });
    }
  }

  return conversations;
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

  win.loadFile(APP_INDEX_PATH);

  win.webContents.openDevTools();

  return win;
}

// --- IPC : API contrôlée côté Main ------------------------------------------
// Chaque canal est déclaré explicitement ici ; le renderer n'a jamais accès
// à ipcRenderer directement (voir preload.js), seulement à ce que preload.js
// expose sur window.electronAPI. Aucun canal pour l'instant (l'exemple
// ping/pong utilisé pour valider ce câblage à l'issue #8 a été retiré, la
// nouvelle UI ne l'utilise plus) : le premier canal réel viendra avec le
// ChatGateway (salons, messages, DM...) et devra, comme le faisait ping,
// valider la provenance de chaque message via isAppUrl(event.senderFrame?.url)
// avant d'agir dessus.

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

ipcMain.handle('obtenir-utilisateurs', async () => {
  const utilisateurs = await mockGateway.obtenirTousLesUtilisateurs();

  const result = [];
  for (const utilisateur of utilisateurs) {
    const presence = await mockGateway.obtenirPresence(utilisateur.id);
    result.push({
      id: utilisateur.id,
      pseudo: utilisateur.pseudo,
      present: presence?.statut === 'en-ligne',
    });
  }

  return result;
});

ipcMain.handle('obtenir-conversations-privees', async () => {
  return obtenirConversationsPriveesPourUI();
});

ipcMain.handle('obtenir-messages-prive', async (_, conversationId) => {
  if (!conversationId) {
    return [];
  }

  const messages = await mockGateway.obtenirMessagesConversation(conversationId);
  return messages
    .slice()
    .sort((first, second) => first.envoi - second.envoi)
    .map(serializeMessage);
});

ipcMain.handle('envoyer-message-prive', async (_, conversationId, contenu) => {
  const safeContenu = typeof contenu === 'string' ? contenu.trim() : '';
  if (!conversationId || !safeContenu) {
    return null;
  }

  const message = await mockGateway.envoyerMessage(
    conversationId,
    CURRENT_USER_ID,
    safeContenu
  );
  return serializeMessage(message);
});

ipcMain.handle("navigate", async (_, page) => {
  await mainWindow.loadFile(
      path.join(
          __dirname,
          "src/presentation/pages",
          page
      )
  );
});