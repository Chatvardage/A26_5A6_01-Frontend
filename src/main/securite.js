// Processus main d'Electron, découpé en modules (voir main.js et
// Architecture.md). Provenance des URL et des appels IPC, CSP.
const { ipcMain, session } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const { isDev } = require('./contexte');

// Racine du projet (dossier de main.js).
const RACINE = path.resolve(__dirname, '..', '..');

// Port du serveur de dev local (ex. Vite) : mettre à jour ici s'il change,
// plutôt que d'accepter n'importe quel port sur localhost.
const DEV_SERVER_PORT = '5173';

// Chemin absolu du dashboard (post-connexion), utilisé pour vérifier qu'une
// navigation file:// reste bien à l'intérieur du bundle (et non, par ex.,
// file:///etc/passwd ou un autre fichier arbitraire du disque).
const APP_PAGES_ROOT = path.resolve(RACINE, 'src', 'presentation', 'pages');
const APP_INDEX_PATH = path.resolve(APP_PAGES_ROOT, 'index.html');

// Vrai si `filePath` (déjà résolu en chemin absolu) reste strictement à
// l'intérieur de APP_PAGES_ROOT. Utilisé à la fois par isAppUrl() (pour les
// URL file://) et par le handler IPC 'navigate' : centraliser le check évite
// que les deux finissent par diverger. Le path.sep final est important : sans
// lui, un dossier voisin comme "pages-evil" passerait le startsWith().
function isPathInsideAppPages(filePath) {
  return filePath.startsWith(`${APP_PAGES_ROOT}${path.sep}`);
}

const APP_LOGIN_PATH = path.resolve(RACINE, 'dist', 'login', 'index.html');

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

function isTrustedIpcEvent(event) {
  return isAppUrl(event.senderFrame?.url ?? '');
}

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

module.exports = {
  RACINE,
  DEV_SERVER_PORT,
  APP_PAGES_ROOT,
  APP_INDEX_PATH,
  APP_LOGIN_PATH,
  isPathInsideAppPages,
  isAppUrl,
  isProdLoginFileUrl,
  configurerCsp,
  isTrustedIpcEvent,
  verifierProvenance,
  exposerCanal,
};
