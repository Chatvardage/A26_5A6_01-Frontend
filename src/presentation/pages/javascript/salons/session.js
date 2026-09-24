// salons/session.js — Envoi de message, profil, déconnexion et initialisation de la page.
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).

el.formulaire.addEventListener('submit', async (event) => {
  event.preventDefault();
  const contenu = el.message.value.trim();
  if (!salonActifId || !contenu) return;

  const auteurId = utilisateurActuelId;
  const salonId = salonActifId;
  el.message.value = '';

  // Hors ligne (etatReseau, JAMAIS `presences` — voir le commentaire sur
  // messagesEnAttenteSalon) : le message est affiché tout de suite, marqué
  // "non livré", sans jamais être transmis au gateway. Se mettre soi-même
  // "hors-ligne" via la page profil
  // n'a donc aucun effet ici, seule une vraie coupure réseau (qui
  // change etatReseau) en a.
  if (etatReseau.statut !== 'connecte') {
    ajouterMessageEnAttenteSalon(
      salonId,
      ChatUiShared.creerMessageEnAttente({
        conversationId: salonId,
        auteurId,
        contenu,
      })
    );
    afficherMessages({ conserverPositionScroll: true });
    return;
  }

  // 1. Annule le timer actif de cet utilisateur s'il existe
  if (timersArretSaisie[auteurId]) {
    clearTimeout(timersArretSaisie[auteurId]);
    delete timersArretSaisie[auteurId];
  }

  // 2. Réinitialise immédiatement l'état de saisie côté backend
  await window.electronAPI.modifierEtatSaisie({
    conversationId: salonId,
    utilisateurId: auteurId,
    est_saisie: false,
  });

  // L'envoi et le rafraîchissement (actualiser()) qui suit ont chacun leur
  // propre try/catch (voir reessayerMessageEnAttenteSalon plus haut, et
  // l'équivalent DM dans message-prive.js, pour le détail du pourquoi) :
  // sans cette séparation, un actualiser() en échec APRÈS un envoi pourtant
  // réussi tomberait dans le même bloc catch qu'un envoi raté — le message
  // (déjà bien parti côté serveur) serait alors à tort remis en attente en
  // double, avec un risque de renvoi réel en double si l'utilisateur clique
  // ensuite sur "Réessayer" pour ce brouillon fantôme.
  let envoye;
  try {
    envoye = await window.electronAPI.envoyerMessageSalon({
      salonId,
      utilisateurId: auteurId,
      contenu,
    });
  } catch (erreur) {
    // Connecté au moment de l'envoi mais échec en cours de route : même
    // traitement qu'un envoi tenté hors ligne, plutôt que de perdre le texte
    // tapé (voir le commentaire plus haut).
    ajouterMessageEnAttenteSalon(
      salonId,
      ChatUiShared.creerMessageEnAttente({
        conversationId: salonId,
        auteurId,
        contenu,
      })
    );
    afficherMessages({ conserverPositionScroll: true });
    notifier(messageErreur(erreur), true);
    return;
  }
  try {
    // Le message renvoyé par le serveur suffit : pas de rechargement complet
    // (voir integrerMessageSalonRecu ; l'écho temps réel est dédoublonné).
    await integrerMessageSalonRecu({ salonId, message: envoye });
  } catch (erreur) {
    // Garde défensive pure — voir le commentaire équivalent dans
    // reessayerMessageEnAttenteSalon plus haut pour le détail du pourquoi
    // (actualiser() n'est pas censée relancer d'erreur aujourd'hui).
    notifier(messageErreur(erreur), true);
  }
});

el.profil?.addEventListener('click', () => {
  window.electronAPI.navigate('profil.html');
});

// Déconnexion : ferme la session côté gateway (jeton
// en mémoire ET persisté sur disque, voir RealGatewayRuntime.deconnexion),
// puis ramène l'app à l'écran de connexion (voir 'navigation:connexion' dans
// main.js). Best-effort sur le premier appel : même si deconnexionSession()
// échouait, on veut quand même renvoyer l'utilisateur à l'écran de
// connexion plutôt que le laisser coincé sur un dashboard désormais invalide.
el.logout?.addEventListener('click', async () => {
  // Le rail du compte suivant ne doit pas afficher nos serveurs.
  ChatUiShared.oublierRailEnCache();
  try {
    await window.electronAPI.deconnexionSession();
  } catch (erreur) {
    console.error('[logout] échec de deconnexionSession :', erreur);
  }
  await window.electronAPI.allerALaConnexion();
});

/**
 * Résout l'utilisateur réellement connecté (session JWT, voir
 * obtenirUtilisateurConnecte dans preload.js/RealGatewayRuntime.js) — une
 * seule identité par session, celle authentifiée sur l'écran de
 * connexion. `sessionStorage.currentUserId` reste écrit ici uniquement comme
 * mécanisme de transmission entre index.html et message-prive.html (voir son
 * usage initial plus haut dans ce fichier), jamais comme source de vérité
 * modifiable par l'utilisateur.
 */
async function initialiserUtilisateurCourant() {
  utilisateurActuel = await window.electronAPI.obtenirUtilisateurConnecte();
  utilisateurActuelId = utilisateurActuel?.id ?? '';
  sessionStorage.setItem('currentUserId', utilisateurActuelId);
}

/**
 * Aligne la page sur les préférences du compte. Appelée au démarrage puis à
 * chaque 'preferences:change' (modification depuis la page profil, un autre
 * sélecteur, ou chargement depuis le serveur à la connexion).
 */
function appliquerPreferences(nouvelles) {
  if (!nouvelles) return;
  preferences = nouvelles;
  ThemeManager.appliquerTheme(nouvelles.theme);
  if (nouvelles.langue) I18n.definirLangueActuelle(nouvelles.langue);
  // NotifPrefs reste la lecture synchrone utilisée partout dans cette page :
  // on y recopie simplement la valeur serveur.
  NotifPrefs.definirMode(utilisateurActuelId, nouvelles.modeNotification);
}

async function initialiser() {
  // Dictionnaire, langue courante et langue par défaut : voir
  // I18n.initialiserDepuisElectronAPI (i18n-browser.js) pour le détail
  // (trois canaux IPC indépendants, lancés en parallèle).
  await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  appliquerTraductionsStatiques();

  // Même principe pour le thème (voir ThemeManager.initialiserDepuisElectronAPI
  // dans theme-browser.js) : appliqué sur <html> tout de suite, avant le
  // premier rendu visible du dashboard.
  await ThemeManager.initialiserDepuisElectronAPI(window.electronAPI);

  try {
    await initialiserUtilisateurCourant();
    appliquerPreferences(await window.electronAPI.obtenirPreferences());
    await chargerEtatReseauEtPresences();
    // À ce stade, le script s'est déjà mis en pause une fois (l'await
    // ci-dessus), donc le reste du script synchrone du module a fini de
    // s'exécuter — `serviceNotifications`, déclaré plus bas dans le fichier
    // (voir "--- Notifications système ---"), est donc garanti défini ici,
    // comme pour definirConversationActivePourNotifs()/notifierMessageSysteme()
    // qui reposent sur le même ordre d'exécution. On récupère l'état de
    // focus réel AVANT le premier appel à actualiser()/afficherMessages(),
    // pour que la toute première conversation affichée au démarrage ne soit
    // marquée "lue" que si la fenêtre a effectivement le focus à ce moment.
    if (typeof serviceNotifications?.isWindowFocused === 'function') {
      fenetreEstFocusee = Boolean(await serviceNotifications.isWindowFocused());
    }
    // Consomme une éventuelle cible laissée par message-prive.js avant une
    // navigation vers cette page suite au clic sur une notification de
    // salon (voir onNavigateToConversation dans ce fichier et CLEF_CIBLE_SALON).
    const cibleSalon = sessionStorage.getItem(CLEF_CIBLE_SALON);
    if (cibleSalon) {
      sessionStorage.removeItem(CLEF_CIBLE_SALON);
      salonActifId = cibleSalon;
    }
    await actualiser();
    // Demandé depuis le « + » du rail de la page des messages privés.
    if (lireStockage(sessionStorage, 'chatvardage:ouvrir-ajout-serveur')) {
      ecrireStockage(sessionStorage, 'chatvardage:ouvrir-ajout-serveur', null);
      el.creerRail.click();
    }
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
  } finally {
    // Premier rendu terminé (ou échoué) : le contenu apparaît en fondu
    // (voir ThemeManager.pagePrete).
    ThemeManager.pagePrete?.();
  }
}

