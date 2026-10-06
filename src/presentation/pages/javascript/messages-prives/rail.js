// messages-prives/rail.js — Rail des serveurs, pastilles non lues, badge et menu
// des notifications.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

// Même clé que salons/etat.js : serveur affiché sur la page des salons.
const CLEF_SERVEUR_ACTIF = 'chatvardage:serveur-actif';

function lireStockage(stockage, clef) {
  try {
    return stockage.getItem(clef);
  } catch {
    return null;
  }
}

function ecrireStockage(stockage, clef, valeur) {
  try {
    stockage.setItem(clef, valeur);
  } catch {
    // Best-effort.
  }
}

// Serveurs du rail (avec les identifiants de leurs salons, pour leur
// pastille « non lu »).
let serveursRail = [];

// --- Rail des serveurs et ses pastilles « non lu » ------------------------
// Une pastille par serveur ayant au moins un salon non lu (compteurs de
// Message-Service, voir NotifPrefs). Best-effort et silencieux : un rail
// qui ne se met pas à jour n'est pas une raison de perturber le reste de
// l'app.
async function actualiserBadgeSalons({ recharger = true } = {}) {
  if (recharger) {
    try {
      serveursRail = (await window.electronAPI.obtenirServeurs()) ?? [];
    } catch {
      return; // Rail best-effort, voir commentaire ci-dessus.
    }
  }
  const pastilles = NotifPrefs.afficheRonds(state.currentUserId)
    ? new Set(
        serveursRail
          .filter(
            (serveur) =>
              NotifPrefs.totalNonLus({
                type: 'salon',
                conversationIds: serveur.salonIds ?? [],
              }) > 0
          )
          .map((serveur) => serveur.id)
      )
    : new Set();
  ChatUiShared.afficherRailServeurs({
    conteneur: document.getElementById('server-rail'),
    avant: document.getElementById('open-create-channel-rail'),
    serveurs: serveursRail,
    serveurActifId: null, // aucun serveur « actif » sur cette page
    nonLus: pastilles,
    surChoix: (serveur) => {
      ecrireStockage(localStorage, CLEF_SERVEUR_ACTIF, serveur.id);
      window.electronAPI.navigate('index.html');
    },
  });
}

/**
 * Badge de l'icône de l'app : total des messages non lus (salons + messages
 * privés, compteurs tenus par Message-Service, voir NotifPrefs). Masqué en
 * mode de notification « aucune », comme les compteurs.
 */
function mettreAJourBadgeApplication() {
  if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
  NotifPrefs.appliquerBadge(
    serviceNotifications,
    NotifPrefs.afficheRonds(state.currentUserId) ? NotifPrefs.totalNonLus() : 0
  );
}

// --- Menu de préférences de notification --------------------------------
function fermerMenuNotif() {
  if (!notifMenu || notifMenu.hidden) return;
  notifMenu.hidden = true;
  notifBtn?.setAttribute('aria-expanded', 'false');
}

function ouvrirMenuNotif() {
  if (!notifMenu) return;
  const modeActuel = NotifPrefs.obtenirMode(state.currentUserId);
  notifMenu.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.checked = radio.value === modeActuel;
  });
  const caseApercu = notifMenu.querySelector('#notif-apercu');
  if (caseApercu) {
    caseApercu.checked = NotifPrefs.afficheApercu(state.currentUserId);
  }
  notifMenu.hidden = false;
  notifBtn?.setAttribute('aria-expanded', 'true');
}

/** Choix du mode de notification (menu des notifications). Appelée une fois, au démarrage (message-prive.js). */
function brancherChoixModeNotification() {
  notifMenu?.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      const precedent = NotifPrefs.obtenirMode(state.currentUserId);
      NotifPrefs.definirMode(state.currentUserId, radio.value);
      fermerMenuNotif();
      const rafraichir = async () => {
        renderConversationList();
        await actualiserBadgeSalons({ recharger: false });
        mettreAJourBadgeApplication();
      };
      await rafraichir();
      try {
        await window.electronAPI.modifierPreferences({
          modeNotification: radio.value,
        });
        notifier(t('notifications.preferenceUpdated'));
      } catch (erreur) {
        NotifPrefs.definirMode(state.currentUserId, precedent);
        await rafraichir();
        notifier(messageErreur(erreur), true);
      }
    });
  });
}
