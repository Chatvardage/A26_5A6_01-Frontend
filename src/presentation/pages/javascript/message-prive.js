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

    renderConversationList();
    await renderActiveConversation();
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
        await refreshConversations();
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

      li.addEventListener('click', () => {
        state.activeConversationId = conversation.id;
        renderConversationList();
        renderActiveConversation();
      });

      listElement.appendChild(li);
    });
  }

  async function renderActiveConversation() {
    if (!state.activeConversationId) {
      if (messageList) {
        messageList.innerHTML = '';
      }
      return;
    }

    const conversation = state.conversations.find(
      (entry) => entry.id === state.activeConversationId
    );

    if (!conversation || !messageList) {
      return;
    }

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
    button.addEventListener('click', () => {
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

      renderConversationList();
      renderActiveConversation();
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

  await initialiserUtilisateurCourant();
  await refreshConversations();
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
