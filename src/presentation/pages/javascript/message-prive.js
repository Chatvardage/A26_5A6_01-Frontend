// Page des messages privés (message-prive.html) : point d'entrée, chargé EN
// DERNIER. Tout le code de la page vit dans javascript/messages-prives/*.js
// (voir l'en-tête de messages-prives/etat.js pour l'ordre de chargement) ;
// ce fichier ne fait que la démarrer, au DOMContentLoaded, dans l'ordre
// d'origine : traductions et thème d'abord, puis abonnements, puis premier
// rendu.

window.addEventListener('DOMContentLoaded', async () => {
  // Dictionnaire, langue courante et thème : voir
  // I18n.initialiserDepuisElectronAPI / ThemeManager.initialiserDepuisElectronAPI.
  // Les deux se modifient désormais depuis la page profil uniquement (voir
  // onPreferencesChange plus bas pour l'application en direct).
  await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  appliquerTraductionsStatiques();
  await ThemeManager.initialiserDepuisElectronAPI(window.electronAPI);

  // Pas de service de notifications système (ex. WSL, voir notifierParRepli
  // dans main.js) : le message s'affiche dans l'app à la place.
  serviceNotifications?.onNotificationRepli?.((message) => {
    notifier(t('notifications.fallbackToast', { texte: message.contenu }));
  });
  if (typeof serviceNotifications?.isWindowFocused === 'function') {
    fenetreEstFocusee = Boolean(await serviceNotifications.isWindowFocused());
  }
  if (typeof serviceNotifications?.onFocusChange === 'function') {
    serviceNotifications.onFocusChange(async (focused) => {
      const regagneLeFocus = focused && !fenetreEstFocusee;
      fenetreEstFocusee = focused;
      if (regagneLeFocus) {
        // La conversation déjà affichée n'a jamais pu être marquée "lue"
        // pendant qu'elle était en arrière-plan (voir
        // renderActiveConversation()) : on relance l'affichage maintenant
        // qu'elle est effectivement visible.
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
      }
    });
  }

  // Clic sur une notification système (voir showMessageNotification dans
  // main.js) : ouvre directement la conversation concernée. Si c'est une
  // conversation privée, on est déjà sur la bonne page ; si c'est un salon,
  // on mémorise la cible et on navigue vers index.html, qui la consommera à
  // son chargement (voir son onNavigateToConversation).
  // Même chemin pour un résultat de recherche (voir plus bas).
  const ouvrirConversation = async (cible) => {
    const conversationId = cible?.conversationId;
    if (!conversationId) return;
    if (cible.type === 'prive') {
      state.activeConversationId = conversationId;
      await renderActiveConversation();
      renderConversationList();
      mettreAJourBadgeApplication();
      // Résultat de recherche : jusqu'au message lui-même.
      if (cible.messageId) await allerAuMessageDm(cible.messageId);
    } else if (cible.type === 'salon') {
      await window.electronAPI.definirCibleNavigation({
        type: 'salon',
        id: conversationId,
      });
      window.electronAPI.navigate('index.html');
    }
  };
  if (typeof serviceNotifications?.onNavigateToConversation === 'function') {
    serviceNotifications.onNavigateToConversation(ouvrirConversation);
  }

  ChatUiShared.brancherRechercheMessages({
    bouton: document.getElementById('open-search'),
    dialogue: document.getElementById('search-dialog'),
    api: window.electronAPI,
    t,
    messageErreur,
    // Recherche dans la conversation privée affichée.
    conversationActive: () => {
      const conversation = trouverConversation(state.activeConversationId);
      return conversation
        ? {
            type: 'prive',
            conversationId: conversation.id,
            nom:
              ChatUiShared.nomAffiche(conversation.otherUser) ||
              t('dm.defaultUser'),
          }
        : null;
    },
    surChoix: ouvrirConversation,
  });

  profilBtn?.addEventListener('click', () => {
    window.electronAPI.navigate('profil.html');
  });

  // Vraie déconnexion — voir le même bouton et le même raisonnement dans
  // renderer.js.
  logoutBtn?.addEventListener('click', async () => {
    // Le rail du compte suivant ne doit pas afficher nos serveurs.
    ChatUiShared.oublierRailEnCache();
    try {
      await window.electronAPI.deconnexionSession();
    } catch (erreur) {
      console.error('[logout] échec de deconnexionSession :', erreur);
    }
    await window.electronAPI.allerALaConnexion();
  });
  // Conversation privée à ouvrir, laissée par la page des salons avant de
  // venir ici (clic sur une notification) et gardée par le processus main
  // (voir 'navigation:prendre-cible'). Fait avant refreshConversations() plus bas : celui-ci
  // ne fixe activeConversationId sur la première conversation que s'il est
  // encore vide, donc le préremplir ici suffit à faire ouvrir la bonne dès
  // le premier rendu.
  const cible = await window.electronAPI.prendreCibleNavigation(['prive']);
  if (cible?.id) state.activeConversationId = cible.id;

  setInterval(async () => {
    await actualiserIndicateurSaisie();
  }, 1500);
  window.electronAPI.onServeurChange?.((evenement) => {
    const nom =
      serveursRail.find((serveur) => serveur.id === evenement.serveurId)?.nom ??
      '';
    const pourMoi = evenement.cibleId === state.currentUserId;
    if (pourMoi && evenement.raison === 'expulse') {
      notifier(t('servers.kickedFrom', { name: nom }), true);
    } else if (pourMoi && evenement.raison === 'invitation') {
      notifier(t('servers.newInvitation'));
    }
    window.clearTimeout(minuteurRail);
    minuteurRail = window.setTimeout(() => actualiserBadgeSalons(), 150);
  });

  // Photo d'un autre utilisateur modifiée : les conversations privées
  // portent l'avatar de l'interlocuteur (otherUser.avatar), on les recharge.
  window.electronAPI.onProfilsPublicsChange?.(async () => {
    await refreshConversations({ conserverPositionScroll: true });
  });

  window.electronAPI.onPreferencesChange(async (nouvelles) => {
    appliquerPreferences(nouvelles);
    appliquerTraductionsStatiques();
    afficherUtilisateurCourant();
    afficherEtatReseau();
    afficherPresenceCourante();
    renderConversationList();
    await renderActiveConversation();
  });

  // Déclenchement automatique du chargement de l'historique plus ancien en
  // s'approchant du haut de la liste (défilement "progressif", en plus du
  // bouton explicite — voir creerStatutHistoriqueDm) : voir le commentaire
  // équivalent dans renderer.js pour le pourquoi de l'absence de garde
  // supplémentaire ici (chargerMessagesPlusAnciensDm est déjà protégée).
  if (messageList) {
    messageList.addEventListener('scroll', () => {
      if (messageList.scrollTop < 80) {
        chargerMessagesPlusAnciensDm();
      }
    });
  }

  if (openNewDmBtn && dmDialog) {
    openNewDmBtn.addEventListener('click', () => {
      renderNewDmChoices();
      dmDialog.showModal();
    });
  }

  brancherFiltres();

  brancherFormulaireMessage();

  // Contenu des messages dans les notifications système (écran verrouillé).
  notifMenu
    ?.querySelector('#notif-apercu')
    ?.addEventListener('change', (event) => {
      NotifPrefs.definirApercu(state.currentUserId, event.target.checked);
    });

  notifBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (notifMenu?.hidden === false) {
      fermerMenuNotif();
    } else {
      ouvrirMenuNotif();
    }
  });

  notifMenu?.addEventListener('click', (event) => event.stopPropagation());

  brancherChoixModeNotification();

  document.addEventListener('click', fermerMenuNotif);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fermerMenuNotif();
  });

  // --- Nouveaux messages en temps réel (salon ou DM) --------------------------
  // Le WebSocket du Serveur-API pousse un événement à chaque nouveau message, salon ou DM
  // confondus (voir 'messages:nouveau' dans main.js/preload.js). Le corps
  // commun (log de diagnostic, résolution du mode, décision de notifier) vit
  // dans NotifPrefs.traiterMessageRecu (notif-prefs.js), partagé avec
  // renderer.js.
  brancherMessagesRecus();

  ChatUiShared.brancherBoutonReessayer({
    api: window.electronAPI,
    element: connectionRetry,
    getEtatReseau: () => etatReseau,
    notifierErreur: (erreur) => notifier(messageErreur(erreur), true),
  });

  // Accusés de lecture (✓✓) et non-lus lus depuis un autre appareil.
  window.electronAPI.onLectureChange?.((lecture) => {
    void appliquerLecture(lecture);
  });

  window.electronAPI.onSynchronisationRequise?.(async () => {
    try {
      // Messages reçus pendant la coupure : compteurs relus sur le serveur.
      await NotifPrefs.chargerNonLus(window.electronAPI);
      await refreshConversations({ conserverPositionScroll: true });
      if (state.activeConversationId)
        await chargerLecturesDm(state.activeConversationId);
      await actualiserBadgeSalons();
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    }
  });

  window.electronAPI.onEtatReseauChange((nouvelEtat) => {
    afficherEtatReseau(nouvelEtat);
  });

  brancherPresence();

  // Mis à jour sur place, sans recharger toutes les conversations (voir
  // appliquerMessageModifie / appliquerMessageSupprime).
  window.electronAPI.onMessageModifieChange(async (message) => {
    await appliquerMessageModifie(message);
  });

  window.electronAPI.onMessageSupprimeChange(async (message) => {
    ChatUiShared.oublierEtatActionMessage(message?.messageId);
    await appliquerMessageSupprime(message?.messageId);
  });

  // Rail affiché tout de suite depuis le cache (voir chat-ui-shared.js),
  // avant tout appel réseau : pas de « saut » du rail entre deux pages.
  ChatUiShared.afficherRailDepuisCache({
    conteneur: document.getElementById('server-rail'),
    avant: document.getElementById('open-create-channel-rail'),
    serveurActifId: null,
    // Pastilles : avec les compteurs de non-lus, voir actualiserBadgeSalons.
    nonLus: new Set(),
    surChoix: (serveur) => {
      ecrireStockage(localStorage, CLEF_SERVEUR_ACTIF, serveur.id);
      window.electronAPI.navigate('index.html');
    },
  });
  try {
    await initialiserUtilisateurCourant();
    await chargerEtatReseauEtPresences();
    // Avant le premier rendu : il affiche les compteurs, et marque lue la
    // conversation affichée.
    await NotifPrefs.chargerNonLus(window.electronAPI);
    await refreshConversations();
  } finally {
    // Premier rendu terminé : le contenu apparaît en fondu (voir
    // ThemeManager.pagePrete). Le rail, lui, est déjà affiché depuis le cache.
    ThemeManager.pagePrete?.();
  }
  await actualiserBadgeSalons();
});

// Logo : retour à la page des salons (dernier serveur affiché). Les icônes
// de serveurs sont branchées par actualiserBadgeSalons().
document.getElementById('home-btn')?.addEventListener('click', () => {
  window.electronAPI.navigate('index.html');
});
// « + » : ouvre la fenêtre « Ajouter un serveur » sur la page des salons.
document
  .getElementById('open-create-channel-rail')
  ?.addEventListener('click', async () => {
    await window.electronAPI.definirCibleNavigation({ type: 'ajout-serveur' });
    window.electronAPI.navigate('index.html');
  });
