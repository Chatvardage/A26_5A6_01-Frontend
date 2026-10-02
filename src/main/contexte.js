// Processus main d'Electron, découpé en modules (voir main.js et
// A26_5A6_01-Infra/docs/architecture-frontend.md). État partagé entre les modules du processus main.
const { LANGUE_PAR_DEFAUT } = require('../i18n/i18n.js');

const isDev = process.env.NODE_ENV === 'development';

// Préférences du compte connecté (voir "Préférences synchronisées" dans
// preferences.js).
const THEME_PAR_DEFAUT = 'sombre';
const THEMES_SUPPORTEES = ['sombre', 'clair'];
const MODE_NOTIFICATION_PAR_DEFAUT = 'systeme';
const MODES_NOTIFICATION = ['systeme', 'discret', 'aucune'];

// État mutable unique du processus main : les modules lisent et écrivent
// `etat.xxx` plutôt que des variables globales d'un seul gros fichier.
const etat = {
  // Langue courante de l'application. Volontairement RÉINITIALISÉE À CHAQUE
  // LANCEMENT (pas de persistance sur disque) : l'app doit toujours démarrer
  // en français par défaut. Partagée entre la page de connexion et le
  // dashboard via les canaux IPC 'langue:obtenir'/'langue:definir' (voir plus
  // bas) — même principe que chatGateway, une instance/état unique côté
  // main, pas un par page.
  langueActuelle: LANGUE_PAR_DEFAUT,
  // Langue choisie EXPLICITEMENT sur l'écran de connexion/inscription (clic
  // FR/EN sans session ouverte), ou null. Seule celle-ci est enregistrée dans
  // le profil à la connexion : sinon, la langue par défaut (ou celle du compte
  // précédent, après une déconnexion) écraserait celle du profil.
  langueChoisieAvantConnexion: null,
  themeActuel: THEME_PAR_DEFAUT,
  modeNotificationActuel: MODE_NOTIFICATION_PAR_DEFAUT,
  aliasActuel: null,
  // Image de profil (data URL) ou null — voir User-Config-Service.
  avatarActuel: null,
  // Référence vers la fenêtre principale, utilisée par le verrou d'instance
  // unique (second-instance) et par 'activate' pour savoir si une fenêtre
  // existe déjà plutôt que de se fier uniquement à getAllWindows().
  mainWindow: null,
  activeConversationId: null,
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
  fenetreEstFocusee: true,
  // Pourquoi l'app est revenue à l'écran de connexion sans action de
  // l'utilisateur (ex. 'session-expiree') : lu UNE fois par la page de
  // connexion, qui affiche alors un message explicatif.
  motifRetourConnexion: null,
  // Ce qu'une page doit ouvrir en arrivant après une navigation (voir
  // 'navigation:definir-cible' dans fenetre.js) : `sessionStorage` ne
  // survit pas de façon fiable à une navigation file:// (piège n° 5).
  cibleNavigation: null,
};

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

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function envoyerVersRenderer(canal, donnees) {
  if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
    etat.mainWindow.webContents.send(canal, donnees);
  }
}

module.exports = {
  isDev,
  THEME_PAR_DEFAUT,
  THEMES_SUPPORTEES,
  MODE_NOTIFICATION_PAR_DEFAUT,
  MODES_NOTIFICATION,
  etat,
  logDebugNotif,
  cleanText,
  envoyerVersRenderer,
};
