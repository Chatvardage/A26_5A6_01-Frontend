const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';

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
            submenu: [process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }],
        },
        {
            label: 'Édition',
            submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        // DevTools uniquement en développement : jamais exposé en production.
        ...(isDev
            ? [{ label: 'Développement', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] }]
            : []),
    ];
    return Menu.buildFromTemplate(template);
}

function createWindow() {
    const win = new BrowserWindow({
        width: 900,
        height: 700,
        icon: path.join(__dirname, 'assets', 'icon.png'), // remplacer par l'icône réelle de l'app
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
    win.webContents.on('will-navigate', (event, url) => {
        const isAppUrl = url.startsWith('file://') || url.startsWith('http://localhost');
        if (!isAppUrl) {
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
// de passthrough générique).
ipcMain.on('ping', (event) => {
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

// Empêche la création de nouvelles fenêtres via des attributs webContents
// non prévus (défense en profondeur, complète setWindowOpenHandler ci-dessus).
app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
});