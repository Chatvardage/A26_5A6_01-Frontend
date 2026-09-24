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

// Salons actuels de `state.currentUserId`, telle que renvoyée par
// obtenirEtatSalons() (voir preload.js). Petit helper pour permettre à un
// appelant qui a besoin à la fois de actualiserBadgeSalons() ET de
// mettreAJourBadgeApplication() de ne faire qu'un seul appel IPC pour les
// deux (voir leur paramètre optionnel `salonsPreChauffes` plus bas).
// Mêmes clés que renderer.js : serveur affiché sur la page des salons, et
// serveurs ayant reçu un message non lu (voir leur déclaration là-bas).
const CLEF_SERVEUR_ACTIF = 'chatvardage:serveur-actif';
const CLEF_SERVEURS_NON_LUS = 'chatvardage:serveurs-non-lus';

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

function serveursNonLus() {
  try {
    return new Set(
      JSON.parse(lireStockage(sessionStorage, CLEF_SERVEURS_NON_LUS) ?? '[]')
    );
  } catch {
    return new Set();
  }
}

// Salons du serveur affiché sur la page des salons (pour la pastille de
// son icône et le badge de l'application).
let serveursRail = [];
// Derniers salons chargés (serveur « actif » du rail), tenus à jour par
// les messages reçus en temps réel : évite de recharger tout l'état des
// salons (serveurs, invitations, historique de chaque salon) à chaque
// message reçu, juste pour les pastilles.
let salonsEnCache = [];
async function obtenirSalonsActuels() {
  const etatSalons = await window.electronAPI.obtenirEtatSalons({
    serveurId: lireStockage(localStorage, CLEF_SERVEUR_ACTIF),
  });
  serveursRail = etatSalons?.serveurs ?? [];
  salonsEnCache = etatSalons?.salons ?? [];
  return salonsEnCache;
}

/** Message de salon reçu : ajouté au salon en cache s'il y est (sinon, il
 * appartient à un autre serveur, dont la pastille est déjà posée). */
function integrerMessageSalonEnCache(salonId, message) {
  const salon = salonsEnCache.find((item) => item.id === salonId);
  if (salon && !salon.messages.some((existant) => existant.id === message.id)) {
    salon.messages = [...salon.messages, message];
  }
  return salonsEnCache;
}

// --- Badge "non lu" sur le rail (icônes qui ramènent à l'accueil) -------
// Ces icônes vivent sur CETTE page mais doivent refléter l'état des
// salons (autre page/fichier). Best-effort et silencieux : un badge qui
// ne se met pas à jour n'est pas une raison de perturber le reste de
// l'app.
async function actualiserBadgeSalons(salonsPreChauffes) {
  let salons = salonsPreChauffes;
  try {
    salons = salons ?? (await obtenirSalonsActuels());
  } catch {
    return; // Rail best-effort, voir commentaire ci-dessus.
  }
  const afficherRonds = NotifPrefs.afficheRonds(state.currentUserId);
  const pastilles = afficherRonds ? serveursNonLus() : new Set();
  const serveurActifId = lireStockage(localStorage, CLEF_SERVEUR_ACTIF);
  const actif =
    serveursRail.find((serveur) => serveur.id === serveurActifId) ??
    serveursRail[0];
  if (
    afficherRonds &&
    actif &&
    salons.some((salon) =>
      NotifPrefs.estNonLu(
        state.currentUserId,
        salon.id,
        NotifPrefs.dernierMessageSalon(salon)
      )
    )
  ) {
    pastilles.add(actif.id);
  }
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
 * Recalcule le nombre total de conversations non lues (salons + messages
 * privés) pour l'utilisateur courant et met à jour le badge de l'icône de
 * l'app (voir mettreAJourBadgeApplication côté main.js). Respecte
 * NotifPrefs.afficheRonds() comme les ronds de notification. Best-effort
 * et silencieux.
 *
 * Le calcul du compte et le dessin de l'icône de badge vivent dans
 * NotifPrefs (notif-prefs.js), partagés avec renderer.js — voir son
 * en-tête pour le pourquoi (évite la divergence entre deux copies).
 *
 * @param {Array} [salonsPreChauffes] Liste de salons déjà récupérée par
 *   l'appelant (voir actualiserBadgeSalons ci-dessus) : évite un second
 *   appel IPC obtenirEtatSalons() identique quand les deux fonctions sont
 *   appelées l'une après l'autre.
 */
async function mettreAJourBadgeApplication(salonsPreChauffes) {
  if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
  if (!NotifPrefs.afficheRonds(state.currentUserId)) {
    NotifPrefs.appliquerBadge(serviceNotifications, 0);
    return;
  }
  let salons = salonsPreChauffes;
  if (!salons) {
    try {
      salons = await obtenirSalonsActuels();
    } catch {
      salons = [];
    }
  }
  let nombre = NotifPrefs.compterSalonsNonLus(state.currentUserId, salons);
  nombre += NotifPrefs.compterConversationsNonLues(
    state.currentUserId,
    state.conversations
  );
  NotifPrefs.appliquerBadge(serviceNotifications, nombre);
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
        // Un seul appel obtenirEtatSalons(), partagé entre les deux mises à
        // jour ci-dessous, plutôt qu'un appel indépendant dans chacune.
        const salons = await obtenirSalonsActuels().catch(() => []);
        actualiserBadgeSalons(salons);
        mettreAJourBadgeApplication(salons);
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
