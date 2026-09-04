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
  const openNewDmBtn = document.getElementById('open-new-dm');
  const dmDialog = document.getElementById('dm-dialog');
  const dmDialogContent = document.getElementById('dialog-content');
  const toastElement = document.getElementById('toast');
  const notifBtn = document.getElementById('open-notif-settings');
  const notifMenu = document.getElementById('notif-menu');

  // window.NotifPrefs vient de notif-prefs.js, un script classique chargé
  // avant ce module (voir message-prive.html) — voir ce fichier pour le
  // pourquoi du partage entre les deux pages plutôt qu'une réimplémentation
  // locale.
  const NotifPrefs = window.NotifPrefs;
  const serviceNotifications = window.notifications;

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

  const state = {
    conversations: [],
    activeConversationId: null,
    currentFilter: 'all',
    currentUserId: null,
    utilisateurs: [],
  };

  function notifier(message, erreur = false) {
    if (!toastElement) {
      return;
    }
    toastElement.textContent = message;
    toastElement.classList.toggle('error', erreur);
    toastElement.classList.add('visible');
    window.setTimeout(() => toastElement.classList.remove('visible'), 2600);
  }

  function messageErreur(erreur) {
    return erreur instanceof Error ? erreur.message : String(erreur);
  }

  function getFilteredConversations() {
    if (state.currentFilter === 'online') {
      return state.conversations.filter(
        (conversation) => conversation.otherUser?.present === true
      );
    }

    return state.conversations;
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
        fermerMenuNotif();
        await refreshConversations();
        await actualiserBadgeSalons();
      });
    }
    const selectedUserId = sessionStorage.getItem('currentUserId');
    state.currentUserId =
      utilisateurs.find((u) => u.id === selectedUserId)?.id ??
      utilisateurs[0]?.id ??
      'u1';
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
      const lastMessage = conversation.lastMessage?.contenu ?? 'Aucun message';
      const statusLabel = otherUser?.present ? 'En ligne' : 'Hors ligne';
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
      username.textContent = otherUser?.pseudo ?? 'Utilisateur';

      const lastMessageEl = document.createElement('div');
      lastMessageEl.classList.add('last-message');
      lastMessageEl.textContent = subtitle;

      info.append(username, lastMessageEl);
      li.append(avatar, info);

      li.addEventListener('click', async () => {
        state.activeConversationId = conversation.id;
        // Voir le commentaire dans refreshConversations() : marquer comme lu
        // doit se faire avant de recalculer les ronds de notification.
        await renderActiveConversation();
        renderConversationList();
        mettreAJourBadgeApplication();
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

    // La conversation affichée est par définition "lue", et c'est la
    // conversation "active" que main.js ne doit pas notifier (voir
    // showMessageNotification côté main.js).
    NotifPrefs.marquerCommeLu(state.currentUserId, conversation.id, Date.now());
    definirConversationActivePourNotifs(conversation.id);

    const messages = [...(conversation.messages ?? [])].sort(
      (a, b) => (a.envoi ?? 0) - (b.envoi ?? 0)
    );
    const otherUser = conversation.otherUser;

    if (topbarName) {
      topbarName.textContent = otherUser?.pseudo ?? 'Utilisateur';
    }
    if (topbarStatus) {
      topbarStatus.textContent = otherUser?.present ? 'En ligne' : 'Hors ligne';
      topbarStatus.classList.toggle('online', Boolean(otherUser?.present));
      topbarStatus.classList.toggle('offline', !otherUser?.present);
    }
    if (topbarAvatar) {
      topbarAvatar.classList.toggle('offline', !otherUser?.present);
    }
    if (typingIndicator) {
      typingIndicator.textContent = otherUser?.present
        ? `${otherUser.pseudo} est en ligne`
        : 'Hors ligne';
    }

    messageList.innerHTML = '';

    if (messages.length === 0) {
      const row = document.createElement('article');
      row.classList.add('message-row');

      const body = document.createElement('div');
      body.classList.add('message-body');

      const text = document.createElement('p');
      text.classList.add('text');
      text.textContent = 'Aucun message pour le moment.';

      body.appendChild(text);
      row.appendChild(body);
      messageList.appendChild(row);
      return;
    }

    messages.forEach((message) => {
      const row = document.createElement('article');
      const isOwn = message.auteurId === state.currentUserId;
      const author =
        message.auteurId === state.currentUserId
          ? 'Moi'
          : (otherUser?.pseudo ?? 'Utilisateur');
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
      empty.textContent = 'Aucun autre utilisateur disponible.';
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
      action.textContent = dejaOuverte ? 'Ouvrir' : 'Nouveau';

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

  if (messageForm && messageInput) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const content = messageInput.value.trim();
      if (!content || !state.activeConversationId) {
        return;
      }

      await window.electronAPI.envoyerMessagePrive({
        conversationId: state.activeConversationId,
        contenu: content,
        utilisateurId: state.currentUserId,
      });
      messageInput.value = '';
      await refreshConversations();
    });
  }

  // --- Badge "non lu" sur le rail (icônes qui ramènent à l'accueil) -------
  // Ces icônes vivent sur CETTE page mais doivent refléter l'état des
  // salons (autre page/fichier). Best-effort et silencieux : un badge qui
  // ne se met pas à jour n'est pas une raison de perturber le reste de
  // l'app.
  async function actualiserBadgeSalons() {
    const dots = document.querySelectorAll('#server-rail .notif-dot');
    if (!dots.length) return;
    if (!NotifPrefs.afficheRonds(state.currentUserId)) {
      dots.forEach((dot) => (dot.hidden = true));
      return;
    }
    try {
      const etatSalons = await window.electronAPI.obtenirEtatSalons(
        state.currentUserId
      );
      const nonLu = (etatSalons?.salons ?? []).some((salon) => {
        const dernier = salon.messages?.[salon.messages.length - 1];
        const dernierMessage = dernier
          ? { auteurId: dernier.auteurId, timestamp: dernier.date }
          : null;
        return NotifPrefs.estNonLu(
          state.currentUserId,
          salon.id,
          dernierMessage
        );
      });
      dots.forEach((dot) => (dot.hidden = !nonLu));
    } catch {
      // Badge best-effort, voir commentaire ci-dessus.
    }
  }

  // --- Badge "nombre de non-lus" sur l'icône de l'app ---------------------
  // Dessine le même badge que renderer.js (voir son commentaire) : dupliqué
  // ici plutôt que partagé, faute de mécanisme de module commun entre
  // renderer.js et les scripts de pages secondaires comme celui-ci (seul
  // notif-prefs.js est partagé, via un <script> classique chargé avant les
  // deux).
  function genererIconeBadge(nombre) {
    const texte = nombre > 9 ? '9+' : String(nombre);
    const taille = 32;
    const canvas = document.createElement('canvas');
    canvas.width = taille;
    canvas.height = taille;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(taille / 2, taille / 2, taille / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texte, taille / 2, taille / 2 + 1);
    return canvas.toDataURL('image/png');
  }

  /**
   * Recalcule le nombre total de conversations non lues (salons + messages
   * privés) pour l'utilisateur courant et met à jour le badge de l'icône de
   * l'app (voir mettreAJourBadgeApplication côté main.js). Respecte
   * NotifPrefs.afficheRonds() comme les ronds de notification. Best-effort
   * et silencieux.
   */
  async function mettreAJourBadgeApplication() {
    if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
    if (!NotifPrefs.afficheRonds(state.currentUserId)) {
      serviceNotifications.setBadgeCount(0, null);
      return;
    }
    let nombre = 0;
    try {
      const etatSalons = await window.electronAPI.obtenirEtatSalons(
        state.currentUserId
      );
      (etatSalons?.salons ?? []).forEach((salon) => {
        const dernier = salon.messages?.[salon.messages.length - 1];
        const dernierMessage = dernier
          ? { auteurId: dernier.auteurId, timestamp: dernier.date }
          : null;
        if (
          NotifPrefs.estNonLu(state.currentUserId, salon.id, dernierMessage)
        ) {
          nombre += 1;
        }
      });
    } catch {
      // Badge best-effort, voir commentaire ci-dessus.
    }
    state.conversations.forEach((conversation) => {
      const nonLu = NotifPrefs.estNonLu(
        state.currentUserId,
        conversation.id,
        conversation.lastMessage
          ? {
              auteurId: conversation.lastMessage.auteurId,
              timestamp: conversation.lastMessage.envoi,
            }
          : null
      );
      if (nonLu) nombre += 1;
    });
    serviceNotifications.setBadgeCount(
      nombre,
      nombre > 0 ? genererIconeBadge(nombre) : null
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
    radio.addEventListener('change', () => {
      NotifPrefs.definirMode(state.currentUserId, radio.value);
      fermerMenuNotif();
      renderConversationList();
      actualiserBadgeSalons();
      mettreAJourBadgeApplication();
      notifier('Préférence de notification mise à jour.');
    });
  });

  document.addEventListener('click', fermerMenuNotif);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') fermerMenuNotif();
  });

  // --- Messages de démo simulés en continu par main.js ---------------------
  // Voir demarrerSimulationMessages() dans main.js et le même bloc dans
  // renderer.js : un message privé (ariane → sam) toutes les 5s et un
  // message dans #général toutes les 10s, en continu, quelle que soit la
  // page actuellement affichée. C'est ce fichier (pas main.js) qui décide,
  // selon le mode NotifPrefs de l'utilisateur actuellement affiché ici, s'il
  // faut déclencher une notification système.
  if (typeof serviceNotifications?.onMockMessage === 'function') {
    serviceNotifications.onMockMessage(async (message) => {
      try {
        const mode = NotifPrefs.obtenirMode(state.currentUserId);
        // Log de diagnostic : lance l'app avec `NODE_ENV=development` pour
        // voir les DevTools et cette ligne dans la console si un message de
        // démo semble ne rien déclencher. Ne casse rien en production.
        console.log(
          `[notifications:message-simule] reçu (type=${message.type}, auteur=${message.auteurId}, utilisateur courant=${state.currentUserId}, mode=${mode})`
        );
        if (message.type === 'salon') {
          await actualiserBadgeSalons();
          mettreAJourBadgeApplication();
        } else {
          await refreshConversations();
        }
        if (message.auteurId === state.currentUserId) {
          console.log(
            '[notifications:message-simule] ignoré : auteur = utilisateur courant (jamais de notif pour son propre message).'
          );
        } else if (mode !== NotifPrefs.MODE_SYSTEME) {
          console.log(
            `[notifications:message-simule] pas de notification système : mode actuel = "${mode}" (seul le mode "systeme" en déclenche).`
          );
        } else {
          notifierMessageSysteme(message);
        }
      } catch (erreur) {
        console.error('[notifications:message-simule] ERREUR:', erreur);
      }
    });
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
