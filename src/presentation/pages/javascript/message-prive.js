// Pas de require() ici : nodeIntegration est désactivé, comme pour
// renderer.js (voir son commentaire équivalent en tête de fichier pour le
// pourquoi complet).
//
// I18n vient de i18n-browser.js, un script classique chargé avant celui-ci
// (voir message-prive.html) qui expose window.I18n comme global — même
// pattern que window.NotifPrefs (voir le garde-fou plus bas dans ce
// fichier), et qui tient tout l'état i18n (dictionnaire, langue
// courante/par défaut) et la logique de lookup/substitution/traduction
// d'erreurs en UN SEUL endroit partagé avec renderer.js, plutôt que deux
// copies à synchroniser à la main (voir i18n-browser.js pour le détail
// complet).
const I18n =
  window.I18n ??
  (() => {
    console.error(
      '[message-prive] window.I18n est introuvable : i18n-browser.js doit être chargé avant ce script (voir message-prive.html). Traductions désactivées pour cette session (clés brutes affichées).'
    );
    return {
      t: (cle) => cle,
      appliquerTraductionsStatiques: () => {},
      messageErreur: (erreur) =>
        erreur instanceof Error ? erreur.message : String(erreur),
      initialiserDepuisElectronAPI: async () => 'fr',
      obtenirLangue: () => 'fr',
      definirLangueActuelle: () => {},
    };
  })();
const t = I18n.t;
const appliquerTraductionsStatiques = I18n.appliquerTraductionsStatiques;

window.addEventListener('DOMContentLoaded', async () => {
  const listElement = document.getElementById('conversation-list');
  const messageList = document.getElementById('message-list');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const topbarName = document.querySelector('.user-name');
  const topbarStatus = document.querySelector('.user-status');
  const topbarAvatar = document.querySelector('.topbar-avatar');
  const typingIndicator = document.getElementById('typing-indicator');
  const filterButtons = document.querySelectorAll('.filter-button');
  const currentUserSelect = document.getElementById('current-user-select');
  const langueSelect = document.getElementById('language-select');
  const openNewDmBtn = document.getElementById('open-new-dm');
  const dmDialog = document.getElementById('dm-dialog');
  const dmDialogContent = document.getElementById('dialog-content');
  const toastElement = document.getElementById('toast');
  const notifBtn = document.getElementById('open-notif-settings');
  const notifMenu = document.getElementById('notif-menu');
  const isTypingNom = document.getElementById('is-typing-nom');

  // Dictionnaire, langue courante et langue par défaut : voir
  // I18n.initialiserDepuisElectronAPI (i18n-browser.js) pour le détail
  // (trois canaux IPC indépendants, lancés en parallèle).
  if (langueSelect) {
    langueSelect.value = await I18n.initialiserDepuisElectronAPI(
      window.electronAPI
    );
  } else {
    await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  }
  appliquerTraductionsStatiques();

  if (langueSelect) {
    langueSelect.addEventListener('change', async (event) => {
      try {
        I18n.definirLangueActuelle(
          await window.electronAPI.definirLangue(event.target.value)
        );
      } catch {
        // Repli silencieux : la langue affichée reste celle d'avant si le
        // canal échoue.
      }
      langueSelect.value = I18n.obtenirLangue();
      appliquerTraductionsStatiques();
      renderConversationList();
      await renderActiveConversation();
    });
  }

  // window.NotifPrefs vient de notif-prefs.js, un script classique chargé
  // avant ce module (voir message-prive.html) — voir ce fichier pour le
  // pourquoi du partage entre les deux pages plutôt qu'une réimplémentation
  // locale.
  // Garde-fou : si notif-prefs.js n'a pas chargé (ordre des <script> changé
  // par erreur dans message-prive.html, échec de chargement, etc.), on
  // dégrade vers un mode "sans notifications" plutôt que de faire planter le
  // rendu des conversations (voir le même garde-fou dans renderer.js).
  const NotifPrefs =
    window.NotifPrefs ??
    (() => {
      console.error(
        '[message-prive] window.NotifPrefs est introuvable : notif-prefs.js doit être chargé avant ce script (voir message-prive.html). Notifications et badges désactivés pour cette session.'
      );
      return {
        MODE_SYSTEME: 'systeme',
        MODE_DISCRET: 'discret',
        MODE_AUCUNE: 'aucune',
        obtenirMode: () => 'aucune',
        definirMode: () => {},
        afficheRonds: () => false,
        marquerCommeLu: () => {},
        estNonLu: () => false,
        compterSalonsNonLus: () => 0,
        compterConversationsNonLues: () => 0,
        genererIconeBadge: () => null,
        appliquerBadge: () => {},
        traiterMessageSimule: async () => {},
      };
    })();
  const serviceNotifications = window.notifications;

  // Miroir de fenetreEstFocusee côté main.js (voir 'window:is-focused' /
  // 'window:focus-changed' dans preload.js) : sert uniquement à décider si
  // la conversation actuellement affichée doit être marquée "lue" (voir
  // renderActiveConversation() plus bas) — même raisonnement que dans
  // renderer.js (voir son commentaire équivalent pour le pourquoi).
  let fenetreEstFocusee = true;
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

  function definirConversationActivePourNotifs(conversationId) {
    if (typeof serviceNotifications?.setActiveConversation === 'function') {
      serviceNotifications.setActiveConversation(conversationId ?? null);
    }
  }

  function notifierMessageSysteme(message) {
    if (
      typeof serviceNotifications?.messageReceived === 'function' &&
      message
    ) {
      serviceNotifications.messageReceived(message);
    }
  }

  // Mêmes clés que renderer.js (voir son commentaire équivalent) : servent à
  // transmettre, à travers une navigation entre les deux pages, la
  // conversation à ouvrir tout de suite après le chargement suite au clic
  // sur une notification.
  const CLEF_CIBLE_DM = 'notif:cible-dm';
  const CLEF_CIBLE_SALON = 'notif:cible-salon';

  // Clic sur une notification système (voir showMessageNotification dans
  // main.js) : ouvre directement la conversation concernée. Si c'est une
  // conversation privée, on est déjà sur la bonne page ; si c'est un salon,
  // on mémorise la cible et on navigue vers index.html, qui la consommera à
  // son chargement (voir son onNavigateToConversation).
  if (typeof serviceNotifications?.onNavigateToConversation === 'function') {
    serviceNotifications.onNavigateToConversation(async (cible) => {
      const conversationId = cible?.conversationId;
      if (!conversationId) return;
      if (cible.type === 'prive') {
        state.activeConversationId = conversationId;
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
      } else if (cible.type === 'salon') {
        sessionStorage.setItem(CLEF_CIBLE_SALON, conversationId);
        window.electronAPI.navigate('index.html');
      }
    });
  }

  const state = {
    conversations: [],
    activeConversationId: null,
    currentFilter: 'all',
    currentUserId: null,
    utilisateurs: [],
    etatsSaisie: {},
  };
  // Consomme une éventuelle cible laissée par renderer.js avant une
  // navigation vers cette page suite au clic sur une notification de
  // conversation privée (voir onNavigateToConversation ci-dessus et
  // CLEF_CIBLE_DM). Fait avant refreshConversations() plus bas : celui-ci
  // ne fixe activeConversationId sur la première conversation que s'il est
  // encore vide, donc le préremplir ici suffit à faire ouvrir la bonne dès
  // le premier rendu.
  const cibleDm = sessionStorage.getItem(CLEF_CIBLE_DM);
  if (cibleDm) {
    sessionStorage.removeItem(CLEF_CIBLE_DM);
    state.activeConversationId = cibleDm;
  }

  function notifier(message, erreur = false) {
    if (!toastElement) {
      return;
    }
    toastElement.textContent = message;
    toastElement.classList.toggle('error', erreur);
    toastElement.classList.add('visible');
    window.setTimeout(() => toastElement.classList.remove('visible'), 2600);
  }

  // messageErreur vient de I18n (i18n-browser.js, voir le garde-fou en tête
  // de fichier) — logique partagée avec renderer.js, voir son commentaire
  // pour le détail (prefix IPC, code d'erreur, repli sur le texte brut).
  const messageErreur = I18n.messageErreur;

  function getFilteredConversations() {
    if (state.currentFilter === 'online') {
      return state.conversations.filter(
        (conversation) => conversation.otherUser?.present === true
      );
    }

    return state.conversations;
  }

  setInterval(async () => {
    await actualiserIndicateurSaisie();
  }, 1500);

  async function actualiserIndicateurSaisie() {
    if (!state.activeConversationId) {
      if (typingIndicator) {
        typingIndicator.hidden = true;
        typingIndicator.style.setProperty('display', 'none', 'important');
      }
      return;
    }

    const etats = await window.electronAPI.obtenirEtatsSaisie(
      state.activeConversationId
    );
    state.etatsSaisie = Array.isArray(etats) ? etats : [];

    const autreUtilisateurEcrit = (state.etatsSaisie || []).some(
      (item) =>
        item.utilisateurId !== state.currentUserId && item.est_saisie === true
    );

    if (typingIndicator) {
      if (autreUtilisateurEcrit) {
        typingIndicator.hidden = false;
        typingIndicator.style.setProperty('display', 'flex', 'important');
      } else {
        typingIndicator.hidden = true;
        typingIndicator.style.setProperty('display', 'none', 'important');
      }
    }
  }

  async function refreshConversations() {
    const conversations = await window.electronAPI.obtenirConversationsPrivees(
      state.currentUserId
    );
    state.conversations = [...conversations].sort((a, b) => {
      const aTime = a.lastMessage?.envoi ?? a.messages?.[0]?.envoi ?? 0;
      const bTime = b.lastMessage?.envoi ?? b.messages?.[0]?.envoi ?? 0;
      return bTime - aTime;
    });

    if (!state.activeConversationId && state.conversations.length > 0) {
      state.activeConversationId = state.conversations[0].id;
    }

    state.etatsSaisie = await window.electronAPI.obtenirEtatsSaisie(
      state.activeConversationId
    );

    if (
      state.currentFilter === 'online' &&
      !state.conversations.some(
        (conversation) =>
          conversation.id === state.activeConversationId &&
          conversation.otherUser?.present
      )
    ) {
      const firstOnline = state.conversations.find(
        (conversation) => conversation.otherUser?.present
      );
      state.activeConversationId = firstOnline?.id ?? null;
    }

    // renderActiveConversation() doit s'exécuter avant renderConversationList() :
    // c'est elle qui marque la conversation active comme "lue"
    // (NotifPrefs.marquerCommeLu). Si renderConversationList() tournait en
    // premier, le rond de notification de cette conversation serait calculé
    // avec l'ancien état (non lu) et ne disparaîtrait qu'au prochain
    // rafraîchissement.
    await renderActiveConversation();
    renderConversationList();
    mettreAJourBadgeApplication();
    actualiserIndicateurSaisie();
  }

  async function initialiserUtilisateurCourant() {
    const utilisateurs = await window.electronAPI.obtenirUtilisateurs();
    state.utilisateurs = utilisateurs;
    if (currentUserSelect) {
      currentUserSelect.innerHTML = '';
      utilisateurs.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.pseudo;
        currentUserSelect.appendChild(option);
      });
      currentUserSelect.addEventListener('change', async (event) => {
        sessionStorage.setItem('currentUserId', event.target.value);
        state.currentUserId = event.target.value;
        if (messageInput) messageInput.value = '';
        fermerMenuNotif();
        await refreshConversations();
        await actualiserBadgeSalons();
        await actualiserIndicateurSaisie();
      });
    }
    const selectedUserId = sessionStorage.getItem('currentUserId');
    let utilisateurResolu = utilisateurs.find(
      (u) => u.id === selectedUserId
    )?.id;

    if (!utilisateurResolu) {
      // sessionStorage ne survit pas forcément à la navigation entre deux
      // pages file:// distinctes (index.html -> message-prive.html) — même
      // incident que "connecté en tant qu'alice par défaut" déjà rencontré
      // sur index.html (voir renderer.js, initialiserUtilisateurCourant, et
      // session:utilisateur-connecte dans main.js), qui applique déjà ce
      // même repli. Sans lui, cette page retombe systématiquement sur le
      // premier utilisateur de la liste plutôt que la personne réellement
      // connectée.
      utilisateurResolu = await window.electronAPI.obtenirUtilisateurConnecte();
    }

    state.currentUserId =
      utilisateurs.find((u) => u.id === utilisateurResolu)?.id ??
      utilisateurs[0]?.id ??
      'u1';
    sessionStorage.setItem('currentUserId', state.currentUserId);
    if (currentUserSelect) {
      currentUserSelect.value = state.currentUserId;
    }
  }

  function renderConversationList() {
    if (!listElement) {
      return;
    }

    const filtered = getFilteredConversations();
    listElement.innerHTML = '';

    const afficherRonds = NotifPrefs.afficheRonds(state.currentUserId);

    filtered.forEach((conversation) => {
      const li = document.createElement('li');
      const otherUser = conversation.otherUser;
      const isActive = conversation.id === state.activeConversationId;
      const lastMessage =
        conversation.lastMessage?.contenu ?? t('dm.noMessage');
      const statusLabel = otherUser?.present ? t('dm.online') : t('dm.offline');
      const subtitle = conversation.lastMessage ? lastMessage : statusLabel;

      li.classList.add('conversation');
      li.classList.toggle('active', isActive);
      li.dataset.conversationId = conversation.id;

      const avatar = document.createElement('div');
      avatar.classList.add('avatar');
      if (!otherUser?.present) {
        avatar.classList.add('offline');
      }

      const nonLu =
        afficherRonds &&
        NotifPrefs.estNonLu(
          state.currentUserId,
          conversation.id,
          conversation.lastMessage
            ? {
                auteurId: conversation.lastMessage.auteurId,
                timestamp: conversation.lastMessage.envoi,
              }
            : null
        );
      const dot = document.createElement('span');
      dot.classList.add('notif-dot', 'notif-dot--avatar');
      dot.hidden = !nonLu;
      avatar.appendChild(dot);

      const info = document.createElement('div');
      info.classList.add('conversation-info');

      const username = document.createElement('div');
      username.classList.add('username');
      username.textContent = otherUser?.pseudo ?? t('dm.defaultUser');

      const lastMessageEl = document.createElement('div');
      lastMessageEl.classList.add('last-message');
      lastMessageEl.textContent = subtitle;

      info.append(username, lastMessageEl);
      li.append(avatar, info);

      li.addEventListener('click', async () => {
        state.activeConversationId = conversation.id;
        if (messageInput) messageInput.value = '';
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
        await actualiserIndicateurSaisie();
      });

      listElement.appendChild(li);
    });
  }

  async function renderActiveConversation() {
    if (!state.activeConversationId) {
      if (messageList) {
        messageList.innerHTML = '';
      }
      definirConversationActivePourNotifs(null);
      return;
    }

    const conversation = state.conversations.find(
      (entry) => entry.id === state.activeConversationId
    );

    if (!conversation || !messageList) {
      // `activeConversationId` pointe vers une conversation qui n'existe
      // plus pour l'utilisateur courant (ex. changement d'utilisateur
      // simulé vers quelqu'un qui n'a pas ce DM) : on ne laisse pas
      // l'ancienne conversation affichée sous le nouvel utilisateur, et on
      // arrête de la considérer comme "active" pour les notifications.
      state.activeConversationId = null;
      if (messageList) {
        messageList.innerHTML = '';
      }
      definirConversationActivePourNotifs(null);
      return;
    }

    // La conversation affichée est "lue" — mais SEULEMENT si la fenêtre a
    // effectivement le focus en ce moment (fenetreEstFocusee) : voir le
    // commentaire équivalent dans renderer.js (afficherMessages()) pour le
    // pourquoi (sinon ce rond de notification et la vraie notification
    // système de main.js, qui exige déjà le focus pour la même décision,
    // finissent en désaccord).
    if (fenetreEstFocusee) {
      NotifPrefs.marquerCommeLu(
        state.currentUserId,
        conversation.id,
        Date.now()
      );
    }
    // La conversation "active" que main.js ne doit pas notifier (voir
    // showMessageNotification côté main.js) reste définie qu'on ait le
    // focus ou non : c'est elle qui est affichée à l'écran.
    definirConversationActivePourNotifs(conversation.id);

    const messages = [...(conversation.messages ?? [])].sort(
      (a, b) => (a.envoi ?? 0) - (b.envoi ?? 0)
    );
    const otherUser = conversation.otherUser;

    if (topbarName) {
      topbarName.textContent = otherUser?.pseudo ?? t('dm.defaultUser');
    }
    if (topbarStatus) {
      topbarStatus.textContent = otherUser?.present
        ? t('dm.online')
        : t('dm.offline');
      topbarStatus.classList.toggle('online', Boolean(otherUser?.present));
      topbarStatus.classList.toggle('offline', !otherUser?.present);
    }
    if (topbarAvatar) {
      topbarAvatar.classList.toggle('offline', !otherUser?.present);
    }
    if (typingIndicator && isTypingNom) {
      // Dans un DM, une seule autre personne peut potentiellement écrire
      // (contrairement à un salon) — son nom est donc fixé une fois ici, à
      // l'ouverture de la conversation, plutôt que recalculé à chaque
      // battement de actualiserIndicateurSaisie() (qui ne gère, lui, que le
      // show/hide selon l'état de saisie réel — voir plus bas).
      isTypingNom.textContent = otherUser?.pseudo ?? t('dm.defaultUser');
    }

    messageList.innerHTML = '';

    if (messages.length === 0) {
      const row = document.createElement('article');
      row.classList.add('message-row');

      const body = document.createElement('div');
      body.classList.add('message-body');

      const text = document.createElement('p');
      text.classList.add('text');
      text.textContent = t('dm.noMessagesYet');

      body.appendChild(text);
      row.appendChild(body);
      messageList.appendChild(row);
      return;
    }

    messages.forEach((message) => {
      const row = document.createElement('article');
      const isOwn = message.auteurId === state.currentUserId;
      const author = isOwn
        ? t('dm.me')
        : (otherUser?.pseudo ?? t('dm.defaultUser'));
      const timeLabel = new Date(message.envoi).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      row.classList.add('message-row');
      if (isOwn) {
        row.classList.add('own-message');
      }

      const avatar = document.createElement('div');
      avatar.classList.add('avatar');
      if (!otherUser?.present && !isOwn) {
        avatar.classList.add('offline');
      }

      const body = document.createElement('div');
      body.classList.add('message-body');

      const meta = document.createElement('div');
      meta.classList.add('message-meta');

      const authorEl = document.createElement('span');
      authorEl.classList.add('author');
      authorEl.textContent = author;

      const timeEl = document.createElement('span');
      timeEl.classList.add('timestamp');
      timeEl.textContent = timeLabel;

      const text = document.createElement('p');
      text.classList.add('text');
      text.textContent = message.contenu;

      meta.append(authorEl, timeEl);
      body.append(meta, text);
      row.append(avatar, body);
      messageList.appendChild(row);
    });
  }

  function renderNewDmChoices() {
    if (!dmDialogContent) {
      return;
    }

    dmDialogContent.innerHTML = '';

    const candidats = state.utilisateurs.filter(
      (user) => user.id !== state.currentUserId
    );

    if (candidats.length === 0) {
      const empty = document.createElement('p');
      empty.classList.add('empty-state');
      empty.textContent = t('dm.noOtherUsers');
      dmDialogContent.appendChild(empty);
      return;
    }

    const liste = document.createElement('div');
    liste.classList.add('choice-list');

    candidats.forEach((user) => {
      const dejaOuverte = state.conversations.some(
        (conversation) => conversation.otherUser?.id === user.id
      );

      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.classList.add('user-choice');

      const nom = document.createElement('span');
      nom.textContent = user.pseudo;

      const action = document.createElement('span');
      action.textContent = dejaOuverte
        ? t('dm.openExisting')
        : t('dm.newLabel');

      bouton.append(nom, action);

      bouton.addEventListener('click', async () => {
        try {
          const conversation =
            await window.electronAPI.demarrerConversationPrivee({
              utilisateurId: state.currentUserId,
              autreUtilisateurId: user.id,
            });
          dmDialog?.close();
          state.activeConversationId = conversation.id;
          state.currentFilter = 'all';
          filterButtons.forEach((item) => {
            item.classList.toggle('active', item.dataset.filter === 'all');
          });
          await refreshConversations();
        } catch (erreur) {
          notifier(messageErreur(erreur), true);
        }
      });

      liste.appendChild(bouton);
    });

    dmDialogContent.appendChild(liste);
  }

  if (openNewDmBtn && dmDialog) {
    openNewDmBtn.addEventListener('click', () => {
      renderNewDmChoices();
      dmDialog.showModal();
    });
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      state.currentFilter = button.dataset.filter ?? 'all';
      filterButtons.forEach((item) => {
        item.classList.toggle('active', item === button);
      });

      const visible = getFilteredConversations();
      if (visible.length === 0) {
        state.activeConversationId = null;
      } else if (
        !visible.some(
          (conversation) => conversation.id === state.activeConversationId
        )
      ) {
        state.activeConversationId = visible[0].id;
      }

      // Voir le commentaire dans refreshConversations() : marquer comme lu
      // doit se faire avant de recalculer les ronds de notification.
      await renderActiveConversation();
      renderConversationList();
      mettreAJourBadgeApplication();
    });
  });

  const timersArretSaisieDm = {};

  if (messageForm && messageInput) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const content = messageInput.value.trim();
      if (!content || !state.activeConversationId) {
        return;
      }

      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;

      // 1. Annule le timer d'inactivité de cet utilisateur s'il existe
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      // 2. Réinitialise immédiatement l'état de saisie
      await window.electronAPI.modifierEtatSaisie({
        conversationId,
        utilisateurId: auteurId,
        est_saisie: false,
      });

      // 3. Envoie le message
      await window.electronAPI.envoyerMessagePrive({
        conversationId,
        contenu: content,
        utilisateurId: auteurId,
      });
      messageInput.value = '';
      await refreshConversations();
    });

    messageInput.addEventListener('input', async (event) => {
      const aDuTexte = event.target.value.trim().length > 0;
      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;

      if (!auteurId || !conversationId) return;

      // Annule le timer précédent de cet utilisateur
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      if (aDuTexte) {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: true,
        });

        // Coupe l'état de saisie après 10 secondes sans frappe
        timersArretSaisieDm[auteurId] = setTimeout(async () => {
          delete timersArretSaisieDm[auteurId];
          await window.electronAPI.modifierEtatSaisie({
            conversationId,
            utilisateurId: auteurId,
            est_saisie: false,
          });
          await actualiserIndicateurSaisie();
        }, 10000);
      } else {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: false,
        });
        await actualiserIndicateurSaisie();
      }
    });
  }

  // Salons actuels de `state.currentUserId`, telle que renvoyée par
  // obtenirEtatSalons() (voir preload.js). Petit helper pour permettre à un
  // appelant qui a besoin à la fois de actualiserBadgeSalons() ET de
  // mettreAJourBadgeApplication() de ne faire qu'un seul appel IPC pour les
  // deux (voir leur paramètre optionnel `salonsPreChauffes` plus bas).
  async function obtenirSalonsActuels() {
    const etatSalons = await window.electronAPI.obtenirEtatSalons(
      state.currentUserId
    );
    return etatSalons?.salons ?? [];
  }

  // --- Badge "non lu" sur le rail (icônes qui ramènent à l'accueil) -------
  // Ces icônes vivent sur CETTE page mais doivent refléter l'état des
  // salons (autre page/fichier). Best-effort et silencieux : un badge qui
  // ne se met pas à jour n'est pas une raison de perturber le reste de
  // l'app.
  async function actualiserBadgeSalons(salonsPreChauffes) {
    const dots = document.querySelectorAll('#server-rail .notif-dot');
    if (!dots.length) return;
    if (!NotifPrefs.afficheRonds(state.currentUserId)) {
      dots.forEach((dot) => (dot.hidden = true));
      return;
    }
    try {
      const salons = salonsPreChauffes ?? (await obtenirSalonsActuels());
      const nonLu = salons.some((salon) =>
        NotifPrefs.estNonLu(
          state.currentUserId,
          salon.id,
          NotifPrefs.dernierMessageSalon(salon)
        )
      );
      dots.forEach((dot) => (dot.hidden = !nonLu));
    } catch {
      // Badge best-effort, voir commentaire ci-dessus.
    }
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
    notifMenu.hidden = false;
    notifBtn?.setAttribute('aria-expanded', 'true');
  }

  notifBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (notifMenu?.hidden === false) {
      fermerMenuNotif();
    } else {
      ouvrirMenuNotif();
    }
  });

  notifMenu?.addEventListener('click', (event) => event.stopPropagation());

  notifMenu?.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      NotifPrefs.definirMode(state.currentUserId, radio.value);
      fermerMenuNotif();
      renderConversationList();
      // Un seul appel obtenirEtatSalons(), partagé entre les deux mises à
      // jour ci-dessous, plutôt qu'un appel indépendant dans chacune.
      const salons = await obtenirSalonsActuels().catch(() => []);
      actualiserBadgeSalons(salons);
      mettreAJourBadgeApplication(salons);
      notifier(t('notifications.preferenceUpdated'));
    });
  });

  document.addEventListener('click', fermerMenuNotif);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fermerMenuNotif();
  });

  // --- Messages de démo simulés (une fois) par main.js ----------------------
  // Voir demarrerSimulationMessages() dans main.js et le même bloc dans
  // renderer.js : un message privé (ariane → sam) après 5s et un message
  // dans #général après 10s, une seule fois, quelle que soit la page
  // actuellement affichée. C'est ce fichier (pas main.js) qui décide, selon
  // le mode NotifPrefs de l'utilisateur actuellement affiché ici, s'il faut
  // déclencher une notification système. Le corps commun (log de
  // diagnostic, résolution du mode, décision de notifier) vit dans
  // NotifPrefs.traiterMessageSimule (notif-prefs.js), partagé avec
  // renderer.js.
  if (typeof serviceNotifications?.onMockMessage === 'function') {
    serviceNotifications.onMockMessage((message) =>
      NotifPrefs.traiterMessageSimule(message, {
        utilisateurId: state.currentUserId,
        surSalon: async () => {
          // Un seul appel obtenirEtatSalons(), partagé entre les deux mises
          // à jour ci-dessous (voir le paramètre salonsPreChauffes de
          // mettreAJourBadgeApplication).
          const salons = await obtenirSalonsActuels().catch(() => []);
          await actualiserBadgeSalons(salons);
          mettreAJourBadgeApplication(salons);
        },
        surPrive: () => refreshConversations(),
        notifierMessageSysteme,
      })
    );
  }

  await initialiserUtilisateurCourant();
  await refreshConversations();
  await actualiserBadgeSalons();
});

// Toute icône de la barre latérale (logo + icônes de serveur) ramène au
// serveur : il n'y a qu'un seul espace de travail dans cette app, donc
// n'importe quelle icône de #server-rail sert d'affordance de retour,
// qu'on soit ou non sur la page des messages privés.
const railButtons = document.querySelectorAll('#server-rail button');

railButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    window.electronAPI.navigate('index.html');
  });
});
