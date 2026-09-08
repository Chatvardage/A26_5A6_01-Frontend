const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  shell,
  ipcMain,
  session,
} = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const {
  MockGatewayRuntime,
} = require('./src/infrastructure/gateways/MockGatewayRuntime.js');
const {
  t,
  LANGUE_PAR_DEFAUT,
  LANGUES_SUPPORTEES,
} = require('./src/i18n/i18n.js');
const translations = require('./src/i18n/translations.json');

const chatGateway = new MockGatewayRuntime();

const isDev = process.env.NODE_ENV === 'development';

// Langue courante de l'application. Volontairement RÉINITIALISÉE À CHAQUE
// LANCEMENT (pas de persistance sur disque) : l'app doit toujours démarrer
// en français par défaut. Partagée entre la page de connexion et le
// dashboard via les canaux IPC 'langue:obtenir'/'langue:definir' (voir plus
// bas) — même principe que chatGateway, une instance/état unique côté
// main, pas un par page.
let langueActuelle = LANGUE_PAR_DEFAUT;

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

// Chemin absolu du dashboard (post-connexion), utilisé pour vérifier qu'une
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

const APP_LOGIN_PATH = path.resolve(__dirname, 'dist', 'login', 'index.html');

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
    // Deux origines file:// légitimes : n'importe quelle page sous
    // src/presentation/pages/ (dashboard, message-prive.html, ...), et le
    // point d'entrée buildé de la page de connexion (dist/login/index.html),
    // qui vit délibérément HORS de cet arbre (voir APP_LOGIN_PATH) — d'où le
    // deuxième cas, sans quoi aucun appel IPC depuis la page de connexion en
    // production ne passait jamais isAppUrl().
    return isPathInsideAppPages(filePath) || filePath === APP_LOGIN_PATH;
  }

  if (isDev && parsed.protocol === 'http:') {
    return parsed.hostname === 'localhost' && parsed.port === DEV_SERVER_PORT;
  }

  return false;
}

// --- Menu applicatif minimal et maîtrisé -----------------------------------
// L'énoncé interdit les menus par défaut non contrôlés en production.
// On construit ici un menu volontairement réduit (pas d'onglets Node/Debug
// exposés en production), avec un `label` explicite sur CHAQUE entrée
// (y compris celles avec un `role`) : les libellés par défaut d'Electron
// pour un `role` suivent la langue du système d'exploitation, pas la
// langue choisie dans l'app — on ne peut pas s'y fier pour l'i18n.
function buildMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [{ role: 'quit', label: t(langueActuelle, 'menu.quit') }],
          },
        ]
      : []),
    {
      label: t(langueActuelle, 'menu.file'),
      submenu: [
        process.platform === 'darwin'
          ? { role: 'close', label: t(langueActuelle, 'menu.close') }
          : { role: 'quit', label: t(langueActuelle, 'menu.quit') },
      ],
    },
    {
      label: t(langueActuelle, 'menu.edit'),
      submenu: [
        { role: 'copy', label: t(langueActuelle, 'menu.copy') },
        { role: 'paste', label: t(langueActuelle, 'menu.paste') },
        { role: 'selectAll', label: t(langueActuelle, 'menu.selectAll') },
      ],
    },
    // DevTools uniquement en développement : jamais exposé en production.
    ...(isDev
      ? [
          {
            label: t(langueActuelle, 'menu.development'),
            submenu: [
              {
                role: 'toggleDevTools',
                label: t(langueActuelle, 'menu.toggleDevTools'),
              },
              { role: 'reload', label: t(langueActuelle, 'menu.reload') },
            ],
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

// Suivi manuel du focus de la fenêtre, via les événements natifs ('focus',
// 'blur') plutôt que via mainWindow.isFocused() interrogé au moment de la
// notification. Sous WSLg, isFocused() s'est révélé peu fiable (reste
// parfois figé sur son ancienne valeur tant qu'aucune autre fenêtre ne vole
// le focus) ; l'événement, lui, est émis au moment réel de la transition,
// donc plus fiable que d'interroger l'état après coup. Un suivi équivalent
// de la minimisation ('minimize'/'restore'/'hide'/'show') a existé ici mais
// s'est révélé totalement inutilisable sous WSLg (aucun de ces événements ne
// se déclenche au clic sur le bouton de réduction natif) — plus rien ne s'en
// sert désormais, voir les logs de diagnostic sur ces événements plus bas si
// jamais ça doit être ressuscité un jour pour du réel Windows/macOS/Linux.
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

  const conversationId = cleanText(message?.conversationId, 120);
  const body = cleanText(message?.contenu, 180);
  if (!conversationId || !body) {
    logDebugNotif(
      '[showMessageNotification] ignoré : message invalide (conversationId ou contenu manquant).'
    );
    return false;
  }

  // Suppression fine, PAS un blocage total pendant que la fenêtre a le
  // focus : avoir l'app ouverte sur un salon ne doit pas rendre muettes
  // toutes les autres conversations (comme Slack/Discord — contrairement à
  // une version précédente de cette fonction qui bloquait TOUTE
  // notification dès que la fenêtre avait le focus, quelle que soit la
  // conversation concernée). On ignore uniquement le cas précis où
  // l'utilisatrice regarde right now (fenêtre focusée) la conversation même
  // qui vient de recevoir ce message — "déjà lue en direct". Voir le
  // commentaire sur fenetreEstFocusee plus haut pour pourquoi c'est le focus
  // (et non la minimisation, abandonnée comme signal — peu fiable sous
  // WSLg) qui est utilisé ici.
  if (fenetreEstFocusee && conversationId === activeConversationId) {
    logDebugNotif(
      `[showMessageNotification] ignoré : conversation "${conversationId}" actuellement affichée et fenêtre au premier plan (déjà "lue" en direct).`
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

  // `message.type` ('salon' ou 'prive') vient tel quel de l'événement
  // d'origine (voir simulerMessagePrive/simulerMessageSalon plus bas, et
  // notifierMessageSysteme côté renderer.js/message-prive.js qui relaie
  // l'objet message complet sans le transformer) : on s'en sert pour dire
  // au renderer sur quelle page/conversation naviguer au clic, en plus de
  // remettre la fenêtre au premier plan. `type` volontairement optionnel
  // (cleanText avec une liste blanche plutôt qu'un champ libre) : un champ
  // inattendu ne doit pas planter le clic, juste désactiver la navigation.
  const type =
    message?.type === 'salon' || message?.type === 'prive'
      ? message.type
      : null;
  notification.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (type) {
      envoyerVersRenderer('notifications:naviguer-vers-conversation', {
        type,
        conversationId,
      });
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
  // peut pas contourner depuis le code de l'app (voir avertirSiWSL()). Confirmé
  // sans appel : aucun de ces événements ('minimize'/'restore'/'hide'/'show')
  // ne se déclenche jamais sous cet environnement — seuls 'focus'/'blur'
  // (voir plus haut) réagissent, d'où l'abandon complet de la minimisation
  // comme signal de suppression des notifications (voir showMessageNotification).
  win.on('hide', () => {
    logDebugNotif('[fenetre] hide');
  });
  win.on('show', () => {
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

// --- Content-Security-Policy de la page de connexion (dev vs prod) --------
// Appliquée via en-tête HTTP plutôt que balise <meta> dans index.html : la
// CSP diffère entre dev et prod, ce qu'une seule balise statique ne peut pas
// exprimer.
//
// - Dev : le plugin React de Vite injecte un <script type="module"> INLINE
//   au tout début de <head> pour amorcer le Fast Refresh (React Refresh
//   runtime) ; 'unsafe-inline' est nécessaire sur script-src en dev
//   uniquement, sinon ce script est bloqué (échec silencieux au chargement).
//   connect-src autorise aussi le WebSocket du serveur de dev (HMR).
// - Prod : le bundle buildé par Vite (`npm run build:login`) ne contient
//   aucun script inline, donc CSP stricte.
//
// Le filtre `isLoginPageRequest` limite l'en-tête à l'origine de la page de
// connexion (serveur de dev en dev, dossier dist/login en prod) pour ne pas
// affecter le dashboard, qui a sa propre politique si besoin.

// Vrai si `url` est la requête file:// pour le point d'entrée buildé de la
// page de connexion (APP_LOGIN_PATH). Réutilise EXACTEMENT la même approche
// que isAppUrl() ci-dessus (parser l'URL, décoder via fileURLToPath, puis
// comparer des chemins résolus) plutôt que de reconstruire une chaîne
// "file://" à partir du chemin disque brut et de comparer par préfixe sur
// l'URL encodée : `win.loadFile()` fait passer le chemin par
// `url.pathToFileURL()`, qui pourcent-encode certains caractères (ex. les
// espaces, fréquents dans "C:\Program Files\..." ou un nom d'utilisateur
// contenant un espace). Un préfixe construit à la main sur le chemin brut ne
// contient jamais ces caractères encodés, donc `details.url.startsWith(...)`
// ne matchait jamais dans ce cas — désactivant silencieusement la CSP
// stricte de production pour la page même qu'elle est censée protéger.
// Décoder l'URL (comme isAppUrl() le fait déjà) avant de comparer élimine
// ce problème à la racine, plutôt que de multiplier les cas spéciaux
// d'encodage/plateforme dans une reconstruction manuelle.
function isProdLoginFileUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'file:') return false;

  let filePath;
  try {
    filePath = path.resolve(fileURLToPath(parsed));
  } catch {
    return false;
  }

  return filePath === APP_LOGIN_PATH;
}

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

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isLoginPageRequest = isDev
      ? details.url.startsWith(devOrigin)
      : isProdLoginFileUrl(details.url);

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
  if (mainWindow) {
    mainWindow.loadFile(APP_INDEX_PATH);
  }
  // Démarre la démo de notifications seulement maintenant : c'est le
  // premier moment où chatGateway.obtenirUtilisateurConnecte() reflète
  // réellement la personne qui vient de se connecter (voir
  // demarrerSimulationMessages plus bas, qui en dépend pour cibler le DM de
  // démo). L'appeler plus tôt (ex. dans app.whenReady(), avant que
  // quiconque ait rempli l'écran de connexion) le ferait toujours annuler
  // silencieusement faute d'utilisateur connecté.
  demarrerSimulationMessages();
});

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

// --- Session (écran de connexion) -------------------------------------------
// chatGateway est une INSTANCE UNIQUE, partagée par la page de connexion et
// le dashboard (contrairement à une instance par renderer, qui perdrait
// l'utilisateur créé dès la navigation vers le dashboard — voir l'incident
// "connecté en tant qu'alice par défaut"). C'est pour ça que ces canaux
// vivent ici, dans le même fichier que les canaux 'salons:*'.
exposerCanal('session:pseudo-disponible', ({ pseudo }) =>
  chatGateway.pseudoDisponible(pseudo)
);
exposerCanal('session:connexion', (utilisateur) =>
  chatGateway.connexion(utilisateur)
);
// Utilisé par le dashboard au démarrage pour savoir qui vient de se
// connecter, au lieu de coder un utilisateur en dur (voir renderer.js).
exposerCanal('session:utilisateur-connecte', () =>
  chatGateway.obtenirUtilisateurConnecte()
);

// --- Simulation réseau / présence -----------------------------------------
exposerCanal('reseau:etat', () => chatGateway.obtenirEtatConnexion());
exposerCanal('reseau:coupure', ({ utilisateurId }) =>
  chatGateway.simulerCoupure(utilisateurId)
);
exposerCanal('reseau:reconnexion', ({ delaiMs, utilisateurId }) =>
  chatGateway.simulerReconnexion(delaiMs, utilisateurId)
);
exposerCanal('presence:obtenir', () => chatGateway.obtenirPresences());
exposerCanal('presence:modifier', (donnees) =>
  chatGateway.modifierPresence(donnees)
);

// Le runtime émet les transitions avant même que l'appel IPC de reconnexion
// soit terminé, ce qui permet à l'UI d'afficher réellement « Reconnexion ».
chatGateway.on('etat-connexion', (etatConnexion) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reseau:etat-change', etatConnexion);
  }
});
chatGateway.on('presence', (presence) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('presence:change', presence);
  }
});
chatGateway.on('message-modifie', (message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('messages:modifie-change', message);
  }
});
chatGateway.on('message-supprime', (message) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('messages:supprime-change', message);
  }
});

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
exposerCanal('langue:obtenir', () => langueActuelle);
exposerCanal('langue:definir', ({ langue }) => {
  if (LANGUES_SUPPORTEES.includes(langue)) {
    langueActuelle = langue;
    Menu.setApplicationMenu(buildMenu());
  }
  return langueActuelle;
});
exposerCanal('i18n:dictionnaires', () => translations);
// Permet à renderer.js/message-prive.js (pas de require(), voir plus haut)
// de dériver leur propre repli initial de LA MÊME constante que le reste de
// l'app, plutôt que de recopier 'fr' en dur indépendamment dans chaque
// fichier — évite une dérive silencieuse si LANGUE_PAR_DEFAUT change un jour.
exposerCanal('i18n:langue-par-defaut', () => LANGUE_PAR_DEFAUT);

// --- Salons ------------------------------------------------------------
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
// deux ID triés puis joints par ':') : dupliquée ici pour la même raison que
// dans MockGatewayRuntime.js (pas d'import direct d'un module TS/CJS croisé).
function creerDmId(utilisateurAId, utilisateurBId) {
  return [utilisateurAId, utilisateurBId].sort().join(':');
}

const DEMO_SALON_ID = 's1'; // général
// Les deux messages de démo sont désormais envoyés "de la part d'ariane"
// (u2), à destination de la personne qui vient de se connecter via l'écran
// de connexion (voir demarrerSimulationMessages ci-dessous) — et non plus
// entre deux comptes de démo fixes (sam/eva) qui n'ont plus de lien avec la
// session réellement ouverte. Comme le nouvel utilisateur est créé avec un
// UUID frais à la connexion (voir LoginPage.tsx), il ne peut jamais être
// 'u2' lui-même (le pseudo "ariane" est déjà pris par ce compte de seed —
// voir pseudoDisponible), donc pas de risque de "notification à soi-même"
// ici, contrairement à l'ancienne version testée en tant que sam/ariane sur
// le dashboard ouvert directement.
const DEMO_EXPEDITEUR_ID = 'u2'; // ariane

let demoDmTimeoutId = null;
let demoSalonTimeoutId = null;

function envoyerVersRenderer(canal, donnees) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(canal, donnees);
  }
}

function simulerMessagePrive(destinataireId) {
  try {
    // S'assure que la conversation existe avant d'y écrire (le seed initial
    // de MockGatewayRuntime ne connaît pas encore ce nouvel utilisateur) ;
    // idempotent si elle existe déjà.
    chatGateway.demarrerConversationPrivee({
      utilisateurId: DEMO_EXPEDITEUR_ID,
      autreUtilisateurId: destinataireId,
    });
    const message = chatGateway.envoyerMessagePrive({
      conversationId: creerDmId(DEMO_EXPEDITEUR_ID, destinataireId),
      utilisateurId: DEMO_EXPEDITEUR_ID,
      contenu: 'Message de démo (ariane → vous).',
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
      utilisateurId: DEMO_EXPEDITEUR_ID,
      contenu: 'Message de démo dans #général (ariane).',
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
  // Jamais en production : voir le commentaire au-dessus de DEMO_EXPEDITEUR_ID.
  // Sans ce garde-fou, chaque lancement de l'app empaquetée injecterait ces
  // deux messages fabriqués dans les conversations de tout le monde.
  if (!isDev) return;

  // Le destinataire du DM de démo est l'utilisateur qui vient de se
  // connecter via l'écran de connexion. Si personne ne s'est connecté par ce
  // biais (ex. dashboard ouvert directement en dev, sans passer par le
  // login), ou si c'est ariane elle-même (ne devrait pas arriver, voir plus
  // haut, mais on se protège quand même), on n'envoie rien plutôt que de
  // planter ou de se notifier soi-même.
  const nouvelUtilisateurId = chatGateway.obtenirUtilisateurConnecte();
  if (!nouvelUtilisateurId || nouvelUtilisateurId === DEMO_EXPEDITEUR_ID) {
    return;
  }

  // Un seul envoi par canal (setTimeout, pas setInterval) : plus de boucle
  // continue une fois les tests de notifications terminés.
  demoDmTimeoutId = setTimeout(
    () => simulerMessagePrive(nouvelUtilisateurId),
    5000
  );
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
// Pagination "charger plus ancien" de l'historique d'un salon : salons:etat
// ci-dessus ne renvoie déjà plus que la page de messages la plus récente
// (voir construireSalonDTO dans MockGatewayRuntime.js).
exposerCanal('salons:messages-avant', (donnees) =>
  chatGateway.obtenirMessagesSalonAvant(donnees)
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
exposerCanal('messages:modifier', (donnees) =>
  chatGateway.modifierMessage(donnees)
);
exposerCanal('messages:supprimer', (donnees) =>
  chatGateway.supprimerMessage(donnees)
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
// Pagination "charger plus ancien" de l'historique d'une conversation
// privée : obtenir-conversations-privees ci-dessus ne renvoie déjà plus que
// la page de messages la plus récente (voir construireConversationPriveeDTO
// dans MockGatewayRuntime.js).
exposerCanal('obtenir-messages-prive-avant', (donnees) =>
  chatGateway.obtenirMessagesPriveesAvant(donnees)
);

exposerCanal('envoyer-message-prive', (donnees) =>
  chatGateway.envoyerMessagePrive(donnees)
);
exposerCanal('demarrer-conversation-privee', (donnees) =>
  chatGateway.demarrerConversationPrivee(donnees)
);

exposerCanal('modifier-etat-saisie', (donnees) =>
  chatGateway.modifierEtatSaisie(donnees)
);

exposerCanal('obtenir-etats-saisie', (donnees) =>
  chatGateway.obtenirEtatsSaisie(donnees)
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
    configurerCsp();
    mainWindow = createWindow();
    // Pas d'appel à demarrerSimulationMessages() ici : à ce stade, la
    // fenêtre affiche l'écran de connexion et personne n'est encore
    // connecté. Voir le handler 'navigation:tableau-de-bord' plus haut, qui
    // la déclenche au bon moment (juste après une connexion réussie).

    app.on('activate', () => {
      // Comportement standard macOS : l'app reste active dans le dock après
      // la fermeture de toutes les fenêtres, et on en recrée une au clic.
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
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
