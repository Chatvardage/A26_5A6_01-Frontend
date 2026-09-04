const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  shell,
  ipcMain,
} = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const {
  MockGatewayRuntime,
} = require('./src/infrastructure/gateways/MockGatewayRuntime.js');

const chatGateway = new MockGatewayRuntime();

const isDev = process.env.NODE_ENV === 'development';

// Active les logs de diagnostic liés aux notifications (avertissement WSL,
// décisions de showMessageNotification, transitions minimize/restore/
// focus/blur/hide/show) : activés par défaut en développement, ou
// explicitement via DEBUG_NOTIFICATIONS=1 (utile pour déboguer un souci de
// notification dans un build empaqueté sans relancer toute l'app en mode
// développement). Désactivés sinon, pour ne pas spammer le terminal en
// usage normal — ces logs sont diagnostiques, pas des erreurs à surveiller
// en continu (voir console.error, laissé actif partout ailleurs).
const debugNotifications = isDev || process.env.DEBUG_NOTIFICATIONS === '1';

function logDebugNotif(...args) {
  if (debugNotifications) {
    console.log(...args);
  }
}

// Port du serveur de dev local (ex. Vite) : mettre à jour ici s'il change,
// plutôt que d'accepter n'importe quel port sur localhost.
const DEV_SERVER_PORT = '5173';

// Chemin absolu du point d'entrée de l'app, utilisé pour vérifier qu'une
// navigation file:// reste bien à l'intérieur du bundle (et non, par ex.,
// file:///etc/passwd ou un autre fichier arbitraire du disque).
const APP_PAGES_ROOT = path.resolve(__dirname, 'src', 'presentation', 'pages');
const APP_INDEX_PATH = path.resolve(APP_PAGES_ROOT, 'index.html');

// Vrai si `filePath` (déjà résolu en chemin absolu) reste strictement à
// l'intérieur de APP_PAGES_ROOT. Utilisé à la fois par isAppUrl() (pour les
// URL file://) et par le handler IPC 'navigate' : centraliser le check évite
// que les deux finissent par diverger. Le path.sep final est important : sans
// lui, un dossier voisin comme "pages-evil" passerait le startsWith().
function isPathInsideAppPages(filePath) {
  return filePath.startsWith(`${APP_PAGES_ROOT}${path.sep}`);
}

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
      filePath = path.resolve(fileURLToPath(parsed));
    } catch {
      return false;
    }
    return isPathInsideAppPages(filePath);
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
let activeConversationId = null;

// Suivi manuel de l'état minimisé/focus de la fenêtre, via les événements
// natifs ('minimize', 'restore', 'focus', 'blur') plutôt que via
// mainWindow.isMinimized()/isFocused() interrogés au moment de la
// notification. Sous WSLg, ces deux méthodes se sont révélées peu fiables :
// isMinimized() semble ne jamais refléter l'état réel une fois la fenêtre
// réduite (probablement parce que WSLg ne relaie pas l'état "minimisé" côté
// Linux, seulement côté barre des tâches Windows), et isFocused() reste
// parfois figé sur son ancienne valeur tant qu'aucune autre fenêtre ne vole
// le focus. Les événements, eux, sont émis au moment réel de la transition
// (Electron doit forcément savoir quand la fenêtre est minimisée pour
// arrêter de la peindre), donc plus fiables que d'interroger l'état après coup.
let fenetreMinimisee = false;
let fenetreEstFocusee = true;

function isTrustedIpcEvent(event) {
  return isAppUrl(event.senderFrame?.url ?? '');
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

// --- Diagnostic WSL ----------------------------------------------------
// L'API Notification d'Electron est déjà cross-plateforme : sur Windows elle
// passe par le Centre de notifications, sur macOS par Notification Center, et
// sur Linux par libnotify (protocole D-Bus). Rien à brancher côté code pour
// que ça fonctionne sur les trois OS — mais WSL est un cas particulier :
// c'est un noyau Linux, donc Electron y utilise systématiquement la voie
// libnotify, même si la fenêtre tourne visuellement dans Windows. WSLg relaie
// normalement ces notifications vers le Centre de notifications Windows,
// MAIS seulement si un bus de session D-Bus fonctionnel tourne dans la
// distribution — ce qui n'est pas garanti par défaut. Symptôme observé :
// showMessageNotification() ci-dessous appelle bien notification.show() sans
// erreur ("notification affichée" dans les logs), mais rien n'apparaît à
// l'écran, parce que personne n'écoute côté D-Bus (voir les avertissements
// "libnotify-WARNING: Failed to connect to proxy" / adresse "disabled:" dans
// la console d'Electron).
function estProbablementWSL() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return require('fs')
      .readFileSync('/proc/version', 'utf8')
      .toLowerCase()
      .includes('microsoft');
  } catch {
    return false;
  }
}

function avertirSiWSL() {
  if (!estProbablementWSL()) return;
  logDebugNotif(
    '[notifications] Exécution détectée sous WSL. Les notifications système ' +
      'passent par libnotify (D-Bus), relayé par WSLg vers le Centre de ' +
      'notifications Windows — mais seulement si un bus D-Bus de session est ' +
      'actif dans la distribution. Si les logs disent "notification ' +
      'affichée" sans que rien ne s\'affiche : (1) vérifier que WSL est à jour ' +
      '(wsl --update, puis wsl --shutdown, depuis PowerShell), (2) activer ' +
      'systemd dans /etc/wsl.conf ([boot]\\nsystemd=true) puis relancer WSL, ' +
      '(3) tester `notify-send "test" "hello"` dans le terminal WSL — si ' +
      "ça n'affiche rien non plus côté Windows, le problème est dans " +
      "l'environnement WSL, pas dans cette app. Sur un Windows, un macOS ou " +
      'un Linux natif (avec un vrai bureau/démon de notifications), ce code ' +
      'fonctionne sans configuration supplémentaire.'
  );
}

function showMessageNotification(message) {
  // Logs de diagnostic (voir aussi les logs côté renderer dans renderer.js /
  // message-prive.js) : utiles pour comprendre pourquoi une notification
  // système ne s'affiche pas sans avoir à deviner. Visibles dans le terminal
  // qui a lancé `npm start`/`electron .` (le processus main n'a pas de
  // console DevTools comme le renderer).
  if (!Notification.isSupported()) {
    logDebugNotif(
      '[showMessageNotification] ignoré : Notification non supportée sur ce système.'
    );
    return false;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    logDebugNotif(
      '[showMessageNotification] ignoré : fenêtre principale absente ou détruite.'
    );
    return false;
  }
  // Voir fenetreMinimisee/fenetreEstFocusee plus haut. On se base ici
  // uniquement sur le focus (fenetreEstFocusee), pas sur fenetreMinimisee :
  // sous WSLg, fenetreMinimisee reste bloqué à `false` en permanence, puisque
  // ni l'événement 'minimize' ni 'hide' ne s'y déclenchent (constaté par les
  // logs). Le focus, lui, fonctionne correctement dès qu'une autre fenêtre le
  // vole réellement — c'est donc le seul signal fiable disponible ici pour
  // savoir si l'utilisatrice regarde effectivement l'app en ce moment.
  const fenetreAuPremierPlan = fenetreEstFocusee;
  if (fenetreAuPremierPlan) {
    // Comportement voulu (comme la plupart des apps de bureau) : pas de
    // notification système si on a déjà la fenêtre au premier plan. Pour
    // observer la notification, mettre l'app en arrière-plan (alt-tab,
    // minimiser) avant le prochain message de démo (toutes les 5s/10s).
    // Le message inclut trois appels IPC natifs (isVisible/isMinimized/
    // isFocused) : on les évite complètement quand debugNotifications est
    // désactivé plutôt que de construire la chaîne (et donc de les
    // appeler) pour la jeter aussitôt à l'intérieur de logDebugNotif — les
    // arguments d'un appel sont toujours évalués avant l'appel lui-même en
    // JS, un simple `if` autour de logDebugNotif() ne suffirait pas côté
    // logDebugNotif seul.
    if (debugNotifications) {
      logDebugNotif(
        `[showMessageNotification] ignoré : la fenêtre de l'app a le focus (mets-la en arrière-plan pour voir la notification). [minimisee=${fenetreMinimisee}, focusee=${fenetreEstFocusee}, isVisible=${mainWindow.isVisible()}, isMinimized=${mainWindow.isMinimized()}, isFocused=${mainWindow.isFocused()}]`
      );
    }
    return false;
  }

  const conversationId = cleanText(message?.conversationId, 120);
  const body = cleanText(message?.contenu, 180);
  if (!conversationId || !body) {
    logDebugNotif(
      '[showMessageNotification] ignoré : message invalide (conversationId ou contenu manquant).'
    );
    return false;
  }
  // Même logique que ci-dessus : "déjà lue en direct" n'a de sens que si
  // l'utilisatrice regarde effectivement la fenêtre à l'instant (focus).
  // Utiliser fenetreMinimisee ici échouait systématiquement sans le sondage
  // PowerShell (voir plus haut) : la conversation affichée avant de perdre
  // le focus restait ignorée pour toujours, même une fois l'app
  // véritablement en arrière-plan.
  if (fenetreEstFocusee && conversationId === activeConversationId) {
    logDebugNotif(
      `[showMessageNotification] ignoré : conversation "${conversationId}" actuellement affichée (déjà "lue" en direct).`
    );
    return false;
  }

  // `silent` volontairement laissé à sa valeur par défaut (false) : c'est ce
  // qui fait jouer le son système de notification (celui de Windows en
  // particulier). Le renderer ne construit cette notification que pour les
  // utilisateurs ayant choisi le mode "Système + son" (voir NotifPrefs dans
  // notif-prefs.js) — ne pas passer silent:true ici sans mettre ce
  // commentaire à jour, ça casserait cette exigence silencieusement.
  const notification = new Notification({
    title: 'Nouveau message',
    body,
    icon: APP_ICON_PATH,
  });

  notification.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notification.show();
  // Note : ce log confirme seulement que notification.show() a été appelé
  // sans erreur, pas que quelque chose est réellement apparu à l'écran —
  // sous Linux/WSL, l'affichage réel dépend d'un service de notification
  // (D-Bus) qui peut être absent même quand cet appel "réussit" (voir
  // avertirSiWSL() plus haut).
  logDebugNotif(
    `[showMessageNotification] notification affichée pour "${conversationId}".`
  );
  return true;
}

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

  // Voir le commentaire sur fenetreMinimisee/fenetreEstFocusee plus haut :
  // ces logs de diagnostic permettent de confirmer, dans le terminal
  // npm start, si ces événements sont bel et bien émis sous WSLg (au cas où
  // ce correctif ne suffirait pas non plus).
  win.on('minimize', () => {
    fenetreMinimisee = true;
    logDebugNotif('[fenetre] minimize');
  });
  win.on('restore', () => {
    fenetreMinimisee = false;
    logDebugNotif('[fenetre] restore');
  });
  win.on('focus', () => {
    fenetreEstFocusee = true;
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
    fenetreEstFocusee = false;
    logDebugNotif('[fenetre] blur');
    envoyerVersRenderer('window:focus-changed', false);
  });
  // Piste de secours : sous WSLg, le bouton de réduction natif ne semble
  // déclencher ni 'minimize' ni changer isMinimized()/isFocused() — peut-être
  // que WSLg traduit ça par 'hide' plutôt que par une vraie minimisation.
  // Log de diagnostic ajouté pour vérifier ; si rien de tout ça ne se
  // déclenche non plus, c'est très probablement une limite de WSLg qu'on ne
  // peut pas contourner depuis le code de l'app (voir avertirSiWSL()).
  win.on('hide', () => {
    fenetreMinimisee = true;
    logDebugNotif('[fenetre] hide');
  });
  win.on('show', () => {
    fenetreMinimisee = false;
    logDebugNotif('[fenetre] show');
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

  return win;
}

// --- IPC : API contrôlée côté Main ------------------------------------------
function verifierProvenance(event) {
  if (!isAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('Origine IPC non autorisée');
  }
}

function exposerCanal(nom, action) {
  ipcMain.handle(nom, (event, donnees) => {
    verifierProvenance(event);
    return action(donnees ?? {});
  });
}

ipcMain.handle(
  'notification:set-active-conversation',
  (event, conversationId) => {
    if (!isTrustedIpcEvent(event)) {
      return false;
    }
    activeConversationId = cleanText(conversationId, 120) || null;
    return true;
  }
);

ipcMain.handle('notification:message-received', (event, message) => {
  if (!isTrustedIpcEvent(event)) {
    return { shown: false };
  }
  return { shown: showMessageNotification(message) };
});

// Permet au renderer de connaître l'état de focus actuel dès son
// initialisation (avant qu'un premier événement 'focus'/'blur' n'ait pu être
// relayé via 'window:focus-changed' ci-dessus) : nécessaire pour que la
// conversation affichée au chargement de la page ne soit marquée "lue" que
// si la fenêtre a bien le focus à ce moment-là (voir le commentaire sur
// 'window:focus-changed' dans createWindow()).
ipcMain.handle('window:is-focused', (event) => {
  if (!isTrustedIpcEvent(event)) {
    return true;
  }
  return fenetreEstFocusee;
});

/**
 * Met à jour l'indicateur de messages non lus sur l'icône de l'app.
 * - macOS et certains environnements Linux (Unity notamment) : app.setBadgeCount()
 *   affiche directement le nombre sur l'icône (dock/launcher) ; sans effet
 *   ailleurs (ex. Windows, où l'appel ne fait rien et ne lève pas d'erreur).
 * - Windows n'a pas d'équivalent à setBadgeCount : on superpose une petite
 *   image sur l'icône de la barre des tâches via setOverlayIcon(). Cette
 *   image (un cercle avec le nombre dedans) est dessinée côté renderer, qui a
 *   accès à <canvas> — main.js se contente de la recevoir en dataURL et de la
 *   convertir en nativeImage.
 */
function mettreAJourBadgeApplication(count, iconDataUrl) {
  const nombre = Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;

  if (process.platform === 'darwin' || process.platform === 'linux') {
    if (typeof app.setBadgeCount === 'function') {
      app.setBadgeCount(nombre);
    }
  }

  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    if (nombre > 0 && iconDataUrl) {
      try {
        mainWindow.setOverlayIcon(
          nativeImage.createFromDataURL(iconDataUrl),
          `${nombre} message(s) non lu(s)`
        );
      } catch (erreur) {
        console.error(
          "[badge] impossible de créer l'icône de superposition Windows :",
          erreur
        );
      }
    } else {
      mainWindow.setOverlayIcon(null, '');
    }
  }
}

ipcMain.handle('notifications:set-badge-count', (event, donnees) => {
  if (!isTrustedIpcEvent(event)) {
    return false;
  }
  mettreAJourBadgeApplication(donnees?.count, donnees?.iconDataUrl);
  return true;
});

// --- Démo : un message simulé par DM et par salon, une seule fois --------
// But : pouvoir observer une notification (système, ou discret/points) sans
// action manuelle, quelle que soit la page actuellement affichée (index.html
// ou message-prive.html), sans avoir à envoyer de vrai message. C'est pour ça
// que ça vit ici, dans le process main, et non dans renderer.js comme
// l'ancien `programmerMessageTest()` (retiré) : les deux pages partagent la
// même fenêtre (`win.loadFile` remplace le document à chaque navigation),
// donc un minuteur posé côté renderer s'arrête dès qu'on change de page.
// Anciennement en boucle continue (setInterval, un message toutes les
// 5s/10s) pour faciliter les tests répétés des notifications ; repassé à un
// envoi unique (setTimeout) une fois les tests terminés — plus de messages
// de démo générés en continu pendant l'utilisation normale de l'app.
// Réservé au développement (voir isDev dans demarrerSimulationMessages
// ci-dessous) : ces messages injectent de fausses données dans l'état réel
// du ChatGateway (chatGateway.envoyerMessagePrive/envoyerMessage), ce qui n'a
// aucun sens pour une utilisatrice réelle d'un build empaqueté — seulement
// pour tester les notifications pendant le développement.
// Chaque message est poussé aux deux pages via l'événement
// 'notifications:message-simule' (voir preload.js / renderer.js /
// message-prive.js) ; c'est le renderer qui décide ensuite, selon le mode
// NotifPrefs de l'utilisateur actuellement affiché, s'il faut déclencher une
// vraie notification système.
//
// Même règle de calcul d'ID que creerDmId() dans MockGatewayRuntime.js (les
// deux ID triés puis joints par ':') : 'u1' < 'u2', donc 'u1:u2'.
const DEMO_DM_ID = 'u1:u2';
const DEMO_DM_EXPEDITEUR_ID = 'u2'; // ariane
const DEMO_SALON_ID = 's1'; // général
// Volontairement 'u3' (eva) et non 'u1' (sam) : le message dans #général doit
// être visible que l'utilisateur simulé courant soit sam OU ariane. S'il
// était envoyé par 'u1', un test fait en tant que sam ne verrait jamais ce
// message comme non lu (on ne se notifie jamais soi-même, voir
// NotifPrefs.estNonLu) — même chose pour le DM si son expéditeur était le
// même que l'utilisateur simulé courant.
const DEMO_SALON_EXPEDITEUR_ID = 'u3'; // eva

let demoDmTimeoutId = null;
let demoSalonTimeoutId = null;

function envoyerVersRenderer(canal, donnees) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(canal, donnees);
  }
}

function simulerMessagePrive() {
  try {
    const message = chatGateway.envoyerMessagePrive({
      conversationId: DEMO_DM_ID,
      utilisateurId: DEMO_DM_EXPEDITEUR_ID,
      contenu: 'Message de démo (ariane → sam).',
    });
    envoyerVersRenderer('notifications:message-simule', {
      type: 'prive',
      ...message,
    });
  } catch (erreur) {
    console.error('[simulerMessagePrive] ERREUR:', erreur);
  }
}

function simulerMessageSalon() {
  try {
    const message = chatGateway.envoyerMessage({
      salonId: DEMO_SALON_ID,
      utilisateurId: DEMO_SALON_EXPEDITEUR_ID,
      contenu: 'Message de démo dans #général (eva).',
    });
    envoyerVersRenderer('notifications:message-simule', {
      type: 'salon',
      conversationId: DEMO_SALON_ID,
      ...message,
    });
  } catch (erreur) {
    console.error('[simulerMessageSalon] ERREUR:', erreur);
  }
}

function demarrerSimulationMessages() {
  arreterSimulationMessages();
  // Jamais en production : voir le commentaire au-dessus de DEMO_DM_ID.
  // Sans ce garde-fou, chaque lancement de l'app empaquetée injecterait ces
  // deux messages fabriqués dans les conversations de tout le monde.
  if (!isDev) return;
  // Un seul envoi par canal (setTimeout, pas setInterval) : plus de boucle
  // continue une fois les tests de notifications terminés.
  demoDmTimeoutId = setTimeout(simulerMessagePrive, 5000);
  demoSalonTimeoutId = setTimeout(simulerMessageSalon, 10000);
}

function arreterSimulationMessages() {
  if (demoDmTimeoutId) clearTimeout(demoDmTimeoutId);
  if (demoSalonTimeoutId) clearTimeout(demoSalonTimeoutId);
  demoDmTimeoutId = null;
  demoSalonTimeoutId = null;
}

exposerCanal('salons:etat', ({ utilisateurId }) =>
  chatGateway.obtenirEtat(utilisateurId)
);
exposerCanal('utilisateurs:lister', () => chatGateway.obtenirUtilisateurs());
exposerCanal('salons:creer', (donnees) => chatGateway.creerSalon(donnees));
exposerCanal('salons:inviter', (donnees) => chatGateway.inviter(donnees));
exposerCanal('salons:accepter-invitation', (donnees) =>
  chatGateway.accepterInvitation(donnees)
);
exposerCanal('salons:refuser-invitation', (donnees) =>
  chatGateway.refuserInvitation(donnees)
);
exposerCanal('salons:envoyer-message', (donnees) =>
  chatGateway.envoyerMessage(donnees)
);
// Comme tous les canaux ci-dessus, ceux-ci font confiance à l'`utilisateurId`
// fourni par le renderer plutôt que de le lier à une session authentifiée :
// il n'y a pas de backend ni de notion de session réelle dans cette maquette
// (l'utilisateur "courant" est un simple sélecteur côté UI, voir renderer.js
// / message-prive.js). C'est cohérent avec le reste de l'app, mais à garder
// en tête si un vrai backend/auth arrive un jour : ces canaux permettent
// aujourd'hui à n'importe quel code du renderer de lire/démarrer les DM de
// n'importe quel utilisateur.
exposerCanal('obtenir-conversations-privees', ({ utilisateurId }) =>
  chatGateway.obtenirConversationsPrivees(utilisateurId)
);

exposerCanal('envoyer-message-prive', (donnees) =>
  chatGateway.envoyerMessagePrive(donnees)
);
exposerCanal('demarrer-conversation-privee', (donnees) =>
  chatGateway.demarrerConversationPrivee(donnees)
);

ipcMain.handle('navigate', (event, page) => {
  verifierProvenance(event);
  const pagePath = path.resolve(
    __dirname,
    'src',
    'presentation',
    'pages',
    page ?? ''
  );
  if (!isPathInsideAppPages(pagePath)) {
    throw new Error('Page de navigation invalide');
  }
  return BrowserWindow.fromWebContents(event.sender)?.loadFile(pagePath);
});

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
    avertirSiWSL();
    Menu.setApplicationMenu(buildMenu());
    mainWindow = createWindow();
    demarrerSimulationMessages();

    app.on('activate', () => {
      // Comportement standard macOS : l'app reste active dans le dock après
      // la fermeture de toutes les fenêtres, et on en recrée une au clic.
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        demarrerSimulationMessages();
      }
    });
  });

  app.on('window-all-closed', () => {
    arreterSimulationMessages();
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
