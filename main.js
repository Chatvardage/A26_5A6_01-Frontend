const { app, BrowserWindow, Menu } = require('electron');

// Processus main d'Electron. Le code vit dans src/main/ (voir
// Architecture.md) : ce fichier ne fait que l'assembler et gérer le cycle de
// vie de l'app.

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

// Après le profil (voir ci-dessus) : ces modules créent le gateway et
// enregistrent les canaux IPC dès leur chargement.
const { etat } = require('./src/main/contexte');
require('./src/main/gateway');
const { configurerCsp } = require('./src/main/securite');
const { buildMenu } = require('./src/main/menu');
const { createWindow } = require('./src/main/fenetre');
const {
  avertirSiWSL,
  surveillerServiceNotificationsLinux,
} = require('./src/main/notifications');
require('./src/main/preferences');
require('./src/main/session');
require('./src/main/canaux-donnees');
const { surveillerReseauSysteme } = require('./src/main/reseau');

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
    if (etat.mainWindow) {
      if (etat.mainWindow.isMinimized()) {
        etat.mainWindow.restore();
      }
      etat.mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    avertirSiWSL();
    surveillerServiceNotificationsLinux();
    Menu.setApplicationMenu(buildMenu());
    configurerCsp();
    etat.mainWindow = createWindow();
    surveillerReseauSysteme();

    app.on('activate', () => {
      // Comportement standard macOS : l'app reste active dans le dock après
      // la fermeture de toutes les fenêtres, et on en recrée une au clic.
      if (BrowserWindow.getAllWindows().length === 0) {
        etat.mainWindow = createWindow();
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
