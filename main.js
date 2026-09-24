const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  shell,
  ipcMain,
  session,
  net,
  powerMonitor,
  screen,
} = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const {
  RealGatewayRuntime,
} = require('./src/infrastructure/gateways/RealGatewayRuntime.js');
const {
  obtenirConfiguration,
} = require('./src/infrastructure/config/ConfigurationApi.js');
const {
  t,
  LANGUE_PAR_DEFAUT,
  LANGUES_SUPPORTEES,
} = require('./src/i18n/i18n.js');
const translations = require('./src/i18n/translations.json');

// --- Profil séparé (tests à plusieurs comptes) --------------------------------
// CHATVARDAGE_PROFIL=2 npm start : dossier de données distinct (session.json,
// localStorage, cache) et donc verrou d'instance unique distinct — voir
// requestSingleInstanceLock plus bas, qui est propre à chaque dossier
// userData. Permet d'ouvrir une deuxième fenêtre connectée à un autre compte.
// Doit être fait avant tout accès à userData (session, verrou).
const PROFIL = process.env.CHATVARDAGE_PROFIL?.trim();
if (PROFIL) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(PROFIL)) {
    console.error(
      `[ChatVardage] CHATVARDAGE_PROFIL invalide : "${PROFIL}" (lettres, chiffres, _ ou -, 32 max).`
    );
    process.exit(1);
  }
  app.setPath('userData', `${app.getPath('userData')}-${PROFIL}`);
  console.log(`[ChatVardage] Profil "${PROFIL}" : ${app.getPath('userData')}`);
}

// Instance UNIQUE du gateway réel (Serveur-API, voir A26_5A6_01-Infra),
// partagée par la page de connexion et le dashboard — voir le commentaire
// plus bas sur les canaux 'session:*' pour pourquoi une seule instance.
const configurationApi = obtenirConfiguration();
const chatGateway = new RealGatewayRuntime(configurationApi);
console.log(
  `[ChatVardage] Gateway actif : ${configurationApi.baseUrlHttp}`
);

const isDev = process.env.NODE_ENV === 'development';

// Langue courante de l'application. Volontairement RÉINITIALISÉE À CHAQUE
// LANCEMENT (pas de persistance sur disque) : l'app doit toujours démarrer
// en français par défaut. Partagée entre la page de connexion et le
// dashboard via les canaux IPC 'langue:obtenir'/'langue:definir' (voir plus
// bas) — même principe que chatGateway, une instance/état unique côté
// main, pas un par page.
let langueActuelle = LANGUE_PAR_DEFAUT;
// Langue choisie EXPLICITEMENT sur l'écran de connexion/inscription (clic
// FR/EN sans session ouverte), ou null. Seule celle-ci est enregistrée dans
// le profil à la connexion : sinon, la langue par défaut (ou celle du compte
// précédent, après une déconnexion) écraserait celle du profil.
let langueChoisieAvantConnexion = null;

// Préférences du compte connecté (voir "Préférences synchronisées" plus bas).
const THEME_PAR_DEFAUT = 'sombre';
const THEMES_SUPPORTEES = ['sombre', 'clair'];
const MODE_NOTIFICATION_PAR_DEFAUT = 'systeme';
const MODES_NOTIFICATION = ['systeme', 'discret', 'aucune'];
let themeActuel = THEME_PAR_DEFAUT;
let modeNotificationActuel = MODE_NOTIFICATION_PAR_DEFAUT;
let aliasActuel = null;
// Image de profil (data URL) ou null — voir User-Config-Service.
let avatarActuel = null;

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
// Fond natif de la fenêtre pour le thème clair (= --bg-panel de styles.css) :
// visible une fraction de seconde entre deux pages, il doit suivre le thème.
const WINDOW_BACKGROUND_COLOR_CLAIR = '#e3f6ef';

function couleurFondFenetre() {
  return themeActuel === 'clair'
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

// --- Service de notifications Linux (D-Bus) ---------------------------------
// Sous Linux, Notification.show() passe par libnotify, qui appelle D-Bus de
// façon SYNCHRONE dans le processus main. Quand aucun démon de notifications
// ne tourne mais que le service est déclaré « activable » (cas typique de
// WSL), D-Bus tente de le démarrer (StartServiceByName) et libnotify attend
// jusqu'à l'expiration (~25 s) : toute l'application est figée pendant ce
// temps. On vérifie donc, en arrière-plan et sans jamais bloquer (processus
// `gdbus` séparé, délai court), qu'un service est RÉELLEMENT actif avant
// d'appeler libnotify ; sinon, repli (voir notifierParRepli).
// CHATVARDAGE_NOTIFICATIONS_SYSTEME=1 force les notifications natives,
// =0 les désactive.
const INTERVALLE_SONDE_NOTIFICATIONS_MS = 60_000;
const DELAI_SONDE_NOTIFICATIONS_MS = 3000;
// 'disponible' | 'absent' | 'inconnu' (sonde pas encore terminée : repli).
let serviceNotificationsLinux =
  process.platform === 'linux' ? 'inconnu' : 'disponible';

function sonderServiceNotificationsLinux() {
  if (process.platform !== 'linux') return;
  const forcage = process.env.CHATVARDAGE_NOTIFICATIONS_SYSTEME;
  if (forcage === '1' || forcage === '0') {
    serviceNotificationsLinux = forcage === '1' ? 'disponible' : 'absent';
    return;
  }
  require('child_process').execFile(
    'gdbus',
    [
      'call',
      '--session',
      '--dest',
      'org.freedesktop.DBus',
      '--object-path',
      '/org/freedesktop/DBus',
      '--method',
      'org.freedesktop.DBus.NameHasOwner',
      'org.freedesktop.Notifications',
    ],
    { timeout: DELAI_SONDE_NOTIFICATIONS_MS },
    (erreur, sortie) => {
      // Toute erreur (gdbus absent, pas de bus de session, délai dépassé)
      // compte comme « absent » : mieux vaut un repli qu'une app figée.
      const etat = !erreur && /\btrue\b/.test(sortie) ? 'disponible' : 'absent';
      if (etat !== serviceNotificationsLinux) {
        logDebugNotif(
          `[notifications] service de notifications D-Bus : ${etat}` +
            (etat === 'absent' ? ' (repli : clignotement + message dans l\'app)' : '')
        );
      }
      serviceNotificationsLinux = etat;
    }
  );
}

function surveillerServiceNotificationsLinux() {
  if (process.platform !== 'linux') return;
  sonderServiceNotificationsLinux();
  // Un démon lancé plus tard (ou arrêté) est pris en compte.
  setInterval(sonderServiceNotificationsLinux, INTERVALLE_SONDE_NOTIFICATIONS_MS);
}

/**
 * Sans service de notifications : fait clignoter l'icône de l'app dans la
 * barre des tâches (arrêté quand la fenêtre reprend le focus) et demande à
 * la page d'afficher le message dans l'app.
 */
function notifierParRepli(type, conversationId, contenu) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
  envoyerVersRenderer('notifications:repli', { type, conversationId, contenu });
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
  // Aperçu masqué (préférence de l'utilisateur, voir NotifPrefs) : texte
  // générique, rien du message lui-même sur un écran verrouillé.
  const body = message?.apercuMasque
    ? t(langueActuelle, 'notifications.hiddenPreview')
    : cleanText(message?.contenu, 180);
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

  // `message.type` ('salon' ou 'prive') vient tel quel de l'événement
  // d'origine (voir notifierMessageSysteme côté renderer.js/message-prive.js)
  // : il indique au renderer sur quelle page/conversation naviguer au clic.
  // Liste blanche plutôt que champ libre : un type inattendu désactive
  // seulement la navigation.
  const type =
    message?.type === 'salon' || message?.type === 'prive'
      ? message.type
      : null;
  if (serviceNotificationsLinux !== 'disponible') {
    notifierParRepli(type, conversationId, body);
    logDebugNotif(
      `[showMessageNotification] repli (service de notifications ${serviceNotificationsLinux}) pour "${conversationId}".`
    );
    return true;
  }

  // `silent` volontairement laissé à sa valeur par défaut (false) : c'est ce
  // qui fait jouer le son système de notification (celui de Windows en
  // particulier). Le renderer ne construit cette notification que pour les
  // utilisateurs ayant choisi le mode "Système + son" (voir NotifPrefs dans
  // notif-prefs.js) — ne pas passer silent:true ici sans mettre ce
  // commentaire à jour, ça casserait cette exigence silencieusement.
  const notification = new Notification({
    // Langue de l'app au moment de la notification (même source que le menu).
    title: t(langueActuelle, 'notifications.newMessageTitle'),
    body,
    icon: APP_ICON_PATH,
  });

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
    // Arrête le clignotement éventuel du repli de notification.
    win.flashFrame(false);
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}/`);
  } else {
    mainWindow.loadFile(APP_LOGIN_PATH);
  }
}

ipcMain.handle('navigation:connexion', (event) => {
  const url = event.senderFrame?.url ?? '';
  if (!isAppUrl(url)) {
    return;
  }
  afficherPageConnexion();
});

// Pourquoi l'app est revenue à l'écran de connexion sans action de
// l'utilisateur (ex. 'session-expiree') : lu UNE fois par la page de
// connexion, qui affiche alors un message explicatif.
let motifRetourConnexion = null;

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

// --- Boutons de la barre de titre (fenêtre sans cadre, voir preload.js) ------
// Agrandir/restaurer est fait à la main (bornes = zone de travail de
// l'écran) plutôt qu'avec maximize()/unmaximize() : sous WSLg, une fenêtre
// sans cadre agrandie par le gestionnaire de fenêtres ne se restaure pas
// correctement, et isMaximized()/'unmaximize' n'y sont pas fiables (même
// limite que 'minimize', voir createWindow).
let bornesAvantAgrandissement = null;

function fenetreEstAgrandie() {
  return bornesAvantAgrandissement !== null || !!mainWindow?.isMaximized();
}

function basculerAgrandissement() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else if (bornesAvantAgrandissement) {
    mainWindow.setBounds(bornesAvantAgrandissement);
    bornesAvantAgrandissement = null;
  } else {
    bornesAvantAgrandissement = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bornesAvantAgrandissement);
    mainWindow.setBounds(workArea);
  }
  const agrandie = fenetreEstAgrandie();
  envoyerVersRenderer('fenetre:maximisee', agrandie);
  return agrandie;
}

exposerCanal('fenetre:reduire', () => mainWindow?.minimize());
exposerCanal('fenetre:agrandir', () => basculerAgrandissement());
exposerCanal('fenetre:fermer', () => mainWindow?.close());
exposerCanal('fenetre:est-maximisee', () => fenetreEstAgrandie());

// --- Session (écran de connexion) -------------------------------------------
// chatGateway est une INSTANCE UNIQUE, partagée par la page de connexion et
// le dashboard (contrairement à une instance par renderer, qui perdrait
// l'utilisateur créé dès la navigation vers le dashboard — voir l'incident
// "connecté en tant qu'alice par défaut"). C'est pour ça que ces canaux
// vivent ici, dans le même fichier que les canaux 'salons:*'.
//
// Authentification par pseudo OU courriel + mot de passe (voir
// AuthGateway.ts / RealGatewayRuntime.authentifier pour le contrat complet).
exposerCanal('session:authentifier', ({ identifiant, motDePasse }) =>
  chatGateway
    .authentifier({ identifiant, motDePasse })
    .then(apresOuvertureSessionAvecLangueChoisie(langueChoisieAvantConnexion))
);
// Écran d'inscription (courriel + mot de passe, pseudo par défaut généré
// côté renderer — voir genererPseudoParDefaut — et transmis ici ; le pseudo
// choisi ici n'est qu'un point de départ, modifiable ensuite sur l'écran
// "Choisis ton pseudo" ou la page profil).
exposerCanal('session:inscription', ({ courriel, motDePasse, pseudo }) =>
  chatGateway
    .inscrire({ courriel, motDePasse, pseudo })
    .then(apresOuvertureSessionAvecLangueChoisie(langueChoisieAvantConnexion))
);
// Reprend une session déjà ouverte lors d'un lancement précédent (jeton
// persisté sur disque), appelé par la page de connexion au démarrage pour
// sauter directement au tableau de bord si possible.
exposerCanal('session:restaurer', () =>
  chatGateway.restaurerSession().then(apresOuvertureSession)
);
// Déconnexion explicite (voir page profil) : ferme le socket, efface le
// jeton en mémoire et sur disque.
/** Préférences propres au compte : on ne les laisse pas fuiter vers le
 * compte suivant. Thème et langue restent tels quels (écran de connexion). */
function oublierPreferencesDuCompte() {
  modeNotificationActuel = MODE_NOTIFICATION_PAR_DEFAUT;
  aliasActuel = null;
  avatarActuel = null;
}

exposerCanal('session:deconnexion', async () => {
  await chatGateway.deconnexion();
  oublierPreferencesDuCompte();
});
exposerCanal('navigation:motif-retour-connexion', () => {
  const motif = motifRetourConnexion;
  motifRetourConnexion = null;
  return motif;
});
// Utilisé par le dashboard au démarrage pour savoir qui vient de se
// connecter, au lieu de coder un utilisateur en dur (voir renderer.js).
exposerCanal('session:utilisateur-connecte', () =>
  chatGateway.obtenirUtilisateurConnecte()
);

// --- Profil (page "Modifier le profil") --------------------------------------
exposerCanal('profil:obtenir', () => chatGateway.profilObtenir());
exposerCanal('profil:modifier-pseudo', ({ pseudo }) =>
  chatGateway.profilModifierPseudo(pseudo)
);
exposerCanal('profil:modifier-compte', (donnees) =>
  chatGateway.profilModifierCompte(donnees)
);
exposerCanal('profil:supprimer-compte', ({ motDePasseActuel }) =>
  chatGateway.profilSupprimerCompte(motDePasseActuel)
);

// --- Configuration utilisateur (alias, thème, langue, notifications) --------
// Source de vérité : User-Config-Service. main.js en garde une copie
// (themeActuel, langueActuelle, modeNotificationActuel, aliasActuel), chargée
// à l'ouverture de session et diffusée à la fenêtre via 'preferences:change'
// à chaque modification, pour que toutes les pages s'y alignent en direct.
// --- Recherche d'utilisateurs (nouveau message privé) -------------------------
exposerCanal('utilisateurs:suggestions-dm', () =>
  chatGateway.obtenirSuggestionsDm()
);
exposerCanal('utilisateurs:rechercher', ({ texte }) =>
  chatGateway.rechercherUtilisateurs(texte)
);

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

// --- Réseau / présence -----------------------------------------------------
exposerCanal('reseau:etat', () => chatGateway.obtenirEtatConnexion());
exposerCanal('reseau:reessayer', () => chatGateway.reconnecterMaintenant());
exposerCanal('presence:obtenir', () => chatGateway.obtenirPresences());
exposerCanal('presence:modifier', ({ statut }) =>
  chatGateway.modifierPresence({ statut })
);

// Le runtime émet les transitions avant même que l'appel IPC de reconnexion
// soit terminé, ce qui permet à l'UI d'afficher réellement « Reconnexion ».
// Jeton expiré ou révoqué en cours d'utilisation (voir
// RealGatewayRuntime.verifierSessionApres401) : la session est déjà fermée
// côté gateway ; on ramène l'app à l'écran de connexion, qui explique
// pourquoi (motifRetourConnexion).
chatGateway.on('session-expiree', () => {
  oublierPreferencesDuCompte();
  motifRetourConnexion = 'session-expiree';
  afficherPageConnexion();
});

chatGateway.on('etat-connexion', (etatConnexion) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('reseau:etat-change', etatConnexion);
  }
});
// Avatar ou alias d'autres utilisateurs modifié (voir
// chargerProfilsPublics) : les pages redessinent les photos concernées.
chatGateway.on('profils-publics', (ids) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('utilisateurs:profils-change', ids);
  }
});
// Changement dans un serveur (membres, salons, invitation, expulsion…),
// signalé en temps réel : les pages rechargent leur état.
chatGateway.on('serveur-change', (evenement) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('serveurs:change', evenement);
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
// Nouveau message reçu en temps réel (salon ou DM), poussé par le WebSocket
// Serveur-API. Voir javascript/salons/temps-reel.js et
// message-prive.js pour le traitement (ajout à la conversation affichée,
// notification système si hors focus).
chatGateway.on('message-recu', (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('messages:nouveau', payload);
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
    if (!chatGateway.obtenirUtilisateurConnecte()) {
      langueChoisieAvantConnexion = langue;
    }
    appliquerPreferencesLocales({ langue });
    persisterPreferenceEnArrierePlan({ langue });
  }
  return langueActuelle;
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
exposerCanal('theme:obtenir', () => themeActuel);
exposerCanal('theme:definir', ({ theme }) => {
  if (THEMES_SUPPORTEES.includes(theme)) {
    appliquerPreferencesLocales({ theme });
    persisterPreferenceEnArrierePlan({ theme });
  }
  return themeActuel;
});
exposerCanal('theme:par-defaut', () => THEME_PAR_DEFAUT);

// --- Préférences synchronisées ------------------------------------------------
function preferencesCourantes() {
  return {
    theme: themeActuel,
    langue: langueActuelle,
    modeNotification: modeNotificationActuel,
    alias: aliasActuel,
    avatar: avatarActuel,
  };
}

function diffuserPreferences() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('preferences:change', preferencesCourantes());
  }
}

/** Met à jour la copie locale (valeurs invalides ignorées) et prévient la
 * fenêtre. `donnees` peut être partiel. */
function appliquerPreferencesLocales(donnees) {
  if (THEMES_SUPPORTEES.includes(donnees.theme)) {
    themeActuel = donnees.theme;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(couleurFondFenetre());
    }
  }
  if (
    LANGUES_SUPPORTEES.includes(donnees.langue) &&
    donnees.langue !== langueActuelle
  ) {
    langueActuelle = donnees.langue;
    Menu.setApplicationMenu(buildMenu());
  }
  if (MODES_NOTIFICATION.includes(donnees.modeNotification)) {
    modeNotificationActuel = donnees.modeNotification;
  }
  if ('alias' in donnees) aliasActuel = donnees.alias || null;
  if ('avatar' in donnees) avatarActuel = donnees.avatar || null;
  diffuserPreferences();
  return preferencesCourantes();
}

async function synchroniserPreferencesDepuisServeur() {
  try {
    appliquerPreferencesLocales(await chatGateway.configObtenir());
  } catch (erreur) {
    console.error('[preferences] chargement depuis le serveur impossible :', erreur);
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
    if (resultat) langueChoisieAvantConnexion = null;
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

// --- Réseau du système d'exploitation ------------------------------------------
// Deux signaux combinés, relayés au gateway (voir signalerReseauSysteme) :
//  1. net.isOnline() : état des interfaces réseau de l'OS. Insuffisant seul :
//     sous WSL (mode NAT), l'interface virtuelle eth0 reste "UP" même quand
//     Windows perd le Wi-Fi, et une interface active ne garantit pas un
//     accès réel au réseau.
//  2. une sonde de connectivité (HEAD sur une URL "generate_204", même
//     principe que Windows/Chrome/Android) : indispensable quand le serveur
//     tourne en local (localhost:3000), puisque couper le réseau ne coupe
//     alors PAS la connexion au serveur — sans cette sonde, rien ne
//     changerait à l'écran. Désactivable avec CHATVARDAGE_CONNECTIVITY_URL=""
//     (seul net.isOnline() est alors utilisé), ou redirigeable vers une
//     autre URL avec cette même variable.
const URL_SONDE_CONNECTIVITE =
  process.env.CHATVARDAGE_CONNECTIVITY_URL ??
  'https://www.gstatic.com/generate_204';
const INTERVALLE_SONDE_RESEAU_MS = 3000;
const DELAI_SONDE_RESEAU_MS = 3000;
// Échecs consécutifs avant de déclarer "hors ligne" (évite qu'un seul
// paquet perdu fasse clignoter l'indicateur) ; un seul succès suffit pour
// repasser "en ligne".
const ECHECS_AVANT_HORS_LIGNE = 2;

async function reseauJoignable() {
  if (!net.isOnline()) return false;
  if (!URL_SONDE_CONNECTIVITE) return true;
  try {
    const reponse = await net.fetch(URL_SONDE_CONNECTIVITE, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(DELAI_SONDE_RESEAU_MS),
    });
    return reponse.status < 500;
  } catch {
    return false;
  }
}

function surveillerReseauSysteme() {
  let dernierEtat = true;
  let echecsConsecutifs = 0;

  const sonder = async () => {
    const joignable = await reseauJoignable();
    echecsConsecutifs = joignable ? 0 : echecsConsecutifs + 1;
    // Interfaces coupées : certain, pas besoin d'attendre un 2e échec.
    const enLigne =
      joignable ||
      (net.isOnline() && echecsConsecutifs < ECHECS_AVANT_HORS_LIGNE);
    if (enLigne !== dernierEtat) {
      dernierEtat = enLigne;
      console.log(`[reseau] système ${enLigne ? 'en ligne' : 'hors ligne'}`);
      chatGateway.signalerReseauSysteme(enLigne);
    }
    // setTimeout (et non setInterval) : jamais deux sondes en parallèle si
    // l'une met du temps à expirer.
    setTimeout(sonder, INTERVALLE_SONDE_RESEAU_MS);
  };
  void sonder();

  powerMonitor.on('resume', () => chatGateway.signalerReveil());
}

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
  // Défense en profondeur : le renderer filtre déjà selon NotifPrefs, mais
  // la préférence serveur fait foi.
  if (modeNotificationActuel !== 'systeme') {
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

function envoyerVersRenderer(canal, donnees) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(canal, donnees);
  }
}

// --- Serveurs et salons (Room-Service) -----------------------------------
// L'autorisation réelle est vérifiée par Room-Service à partir du JWT et du
// rôle de l'utilisateur DANS le serveur ; l'UI ne fait que masquer les
// actions indisponibles.
exposerCanal('salons:etat', ({ serveurId, salonId } = {}) =>
  chatGateway.obtenirEtat({ serveurId, salonId })
);
// Pagination "charger plus ancien" de l'historique d'un salon : salons:etat
// ci-dessus ne renvoie déjà plus que la page de messages la plus récente.
exposerCanal('salons:messages-avant', (donnees) =>
  chatGateway.obtenirMessagesSalonAvant(donnees)
);
exposerCanal('utilisateurs:lister', () => chatGateway.obtenirUtilisateurs());
exposerCanal('serveurs:lister', () => chatGateway.obtenirServeurs());
exposerCanal('serveurs:creer', (donnees) => chatGateway.creerServeur(donnees));
exposerCanal('serveurs:modifier', (donnees) =>
  chatGateway.modifierServeur(donnees)
);
exposerCanal('serveurs:supprimer', ({ serveurId }) =>
  chatGateway.supprimerServeur(serveurId)
);
exposerCanal('serveurs:rejoindre', ({ serveurId }) =>
  chatGateway.rejoindreServeur(serveurId)
);
exposerCanal('serveurs:quitter', ({ serveurId }) =>
  chatGateway.quitterServeur(serveurId)
);
exposerCanal('serveurs:decouvrir', ({ texte }) =>
  chatGateway.decouvrirServeurs(texte)
);
exposerCanal('serveurs:expulser', (donnees) =>
  chatGateway.expulserMembre(donnees)
);
exposerCanal('serveurs:changer-role', (donnees) =>
  chatGateway.changerRoleMembre(donnees)
);
exposerCanal('serveurs:inviter', (donnees) => chatGateway.inviter(donnees));
exposerCanal('serveurs:accepter-invitation', (donnees) =>
  chatGateway.accepterInvitation(donnees)
);
exposerCanal('serveurs:refuser-invitation', (donnees) =>
  chatGateway.refuserInvitation(donnees)
);
exposerCanal('salons:creer', (donnees) => chatGateway.creerSalon(donnees));
exposerCanal('salons:modifier', (donnees) => chatGateway.modifierSalon(donnees));
exposerCanal('salons:supprimer', ({ salonId }) =>
  chatGateway.supprimerSalon(salonId)
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
// Pastilles « non lu » : dernier message de chaque conversation seulement.
exposerCanal('resumes-conversations-privees', () =>
  chatGateway.obtenirResumesConversationsPrivees()
);
exposerCanal('obtenir-conversations-privees', () =>
  chatGateway.obtenirConversationsPrivees()
);
// Pagination "charger plus ancien" de l'historique d'une conversation
// privée : obtenir-conversations-privees ci-dessus ne renvoie déjà plus que
// la page de messages la plus récente (voir obtenirConversationsPrivees
// dans RealGatewayRuntime.js).
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
// cohabiter deux processus. Le verrou est propre au dossier userData : une
// instance lancée avec CHATVARDAGE_PROFIL (voir en haut du fichier) a le
// sien et peut donc tourner en parallèle.
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
    surveillerServiceNotificationsLinux();
    Menu.setApplicationMenu(buildMenu());
    configurerCsp();
    mainWindow = createWindow();
    surveillerReseauSysteme();

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
