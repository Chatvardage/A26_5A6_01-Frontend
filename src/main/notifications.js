// Processus main d'Electron, découpé en modules (voir main.js et
// A26_5A6_01-Infra/docs/architecture-frontend.md). Notifications système et badge.
const { app, nativeImage, Notification } = require('electron');
const { t } = require('../i18n/i18n.js');
const {
  etat,
  logDebugNotif,
  cleanText,
  envoyerVersRenderer,
} = require('./contexte');
const { exposerCanal } = require('./securite');
const { APP_ICON_PATH } = require('./fenetre');

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
            (etat === 'absent'
              ? " (repli : clignotement + message dans l'app)"
              : '')
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
  setInterval(
    sonderServiceNotificationsLinux,
    INTERVALLE_SONDE_NOTIFICATIONS_MS
  );
}

/**
 * Sans service de notifications : fait clignoter l'icône de l'app dans la
 * barre des tâches (arrêté quand la fenêtre reprend le focus) et demande à
 * la page d'afficher le message dans l'app.
 */
function notifierParRepli(type, conversationId, contenu) {
  if (
    etat.mainWindow &&
    !etat.mainWindow.isDestroyed() &&
    !etat.mainWindow.isFocused()
  ) {
    etat.mainWindow.flashFrame(true);
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
  if (!etat.mainWindow || etat.mainWindow.isDestroyed()) {
    logDebugNotif(
      '[showMessageNotification] ignoré : fenêtre principale absente ou détruite.'
    );
    return false;
  }

  const conversationId = cleanText(message?.conversationId, 120);
  // Aperçu masqué (préférence de l'utilisateur, voir NotifPrefs) : texte
  // générique, rien du message lui-même sur un écran verrouillé.
  const body = message?.apercuMasque
    ? t(etat.langueActuelle, 'notifications.hiddenPreview')
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
  if (etat.fenetreEstFocusee && conversationId === etat.activeConversationId) {
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
    title: t(etat.langueActuelle, 'notifications.newMessageTitle'),
    body,
    icon: APP_ICON_PATH,
  });

  notification.on('click', () => {
    if (etat.mainWindow && !etat.mainWindow.isDestroyed()) {
      etat.mainWindow.show();
      etat.mainWindow.focus();
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

// --- Salons ------------------------------------------------------------
exposerCanal(
  'notification:set-active-conversation',
  (conversationId) => {
    etat.activeConversationId = cleanText(conversationId, 120) || null;
    return true;
  },
  { siRefuse: false }
);

exposerCanal(
  'notification:message-received',
  (message) => {
    // Défense en profondeur : le renderer filtre déjà selon NotifPrefs, mais
    // la préférence serveur fait foi.
    if (etat.modeNotificationActuel !== 'systeme') {
      return { shown: false };
    }
    return { shown: showMessageNotification(message) };
  },
  { siRefuse: { shown: false } }
);

// Permet au renderer de connaître l'état de focus actuel dès son
// initialisation (avant qu'un premier événement 'focus'/'blur' n'ait pu être
// relayé via 'window:focus-changed' ci-dessus) : nécessaire pour que la
// conversation affichée au chargement de la page ne soit marquée "lue" que
// si la fenêtre a bien le focus à ce moment-là (voir le commentaire sur
// 'window:focus-changed' dans createWindow()).
exposerCanal('window:is-focused', () => etat.fenetreEstFocusee, {
  siRefuse: true,
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

  if (
    process.platform === 'win32' &&
    etat.mainWindow &&
    !etat.mainWindow.isDestroyed()
  ) {
    if (nombre > 0 && iconDataUrl) {
      try {
        etat.mainWindow.setOverlayIcon(
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
      etat.mainWindow.setOverlayIcon(null, '');
    }
  }
}

exposerCanal(
  'notifications:set-badge-count',
  (donnees) => {
    mettreAJourBadgeApplication(donnees?.count, donnees?.iconDataUrl);
    return true;
  },
  { siRefuse: false }
);

module.exports = {
  estProbablementWSL,
  avertirSiWSL,
  surveillerServiceNotificationsLinux,
  showMessageNotification,
};
