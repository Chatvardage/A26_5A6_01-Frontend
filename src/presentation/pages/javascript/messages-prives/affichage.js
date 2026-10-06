// messages-prives/affichage.js — Rendu de la liste et de la conversation active.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

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
    const lastMessage = conversation.lastMessage?.contenu ?? t('dm.noMessage');
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
    ChatUiShared.remplirAvatar(avatar, otherUser?.avatar);

    const info = document.createElement('div');
    info.classList.add('conversation-info');

    const username = document.createElement('div');
    username.classList.add('username');
    username.textContent =
      ChatUiShared.nomAffiche(otherUser) || t('dm.defaultUser');

    const lastMessageEl = document.createElement('div');
    lastMessageEl.classList.add('last-message');
    lastMessageEl.textContent = subtitle;

    info.append(username, lastMessageEl);
    // Messages non lus (compteurs de Message-Service, voir NotifPrefs).
    const compteur = document.createElement('span');
    compteur.classList.add('notif-count', 'notif-count--conversation');
    NotifPrefs.remplirCompteur(
      compteur,
      NotifPrefs.nombreNonLus('prive', conversation.id),
      afficherRonds
    );
    li.append(avatar, info, compteur);

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

function reinitialiserHistoriqueDm() {
  etatHistoriqueDm = {
    conversationId: null,
    messagesAnciens: [],
    finHistorique: false,
    enChargement: false,
  };
}

/** En-tête quand aucune conversation n'est ouverte. */
function afficherAucuneConversation() {
  // Ni photo ni pastille de présence : il n'y a personne en face.
  ChatUiShared.remplirAvatar(topbarAvatar, null);
  topbarAvatar?.classList.add('sans-presence');
  if (topbarName) topbarName.textContent = t('dm.selectConversation');
  if (topbarStatus) {
    topbarStatus.textContent = t('dm.noActiveConversation');
    topbarStatus.classList.remove('online', 'offline');
  }
}

async function renderActiveConversation(options = {}) {
  // Mêmes options que afficherMessages() (renderer.js) : contenu inséré en
  // haut (conserverPositionScroll) ou ajouté en bas sans suivre
  // (garderScroll) ; sinon défilement tout en bas.
  const { conserverPositionScroll = false, garderScroll = false } = options;
  if (!state.activeConversationId) {
    if (messageList) {
      messageList.innerHTML = '';
    }
    afficherAucuneConversation();
    definirConversationActivePourNotifs(null);
    reinitialiserHistoriqueDm();
    // composerAutorise (voir afficherEtatReseau) est calculé à partir de
    // state.activeConversationId : sans ce rappel, un composer resterait
    // activé alors qu'il n'y a plus de conversation active pour recevoir
    // le message tapé.
    afficherEtatReseau();
    return;
  }

  const conversation = state.conversations.find(
    (entry) => entry.id === state.activeConversationId
  );

  if (!conversation || !messageList) {
    // `activeConversationId` pointe vers une conversation qui n'existe
    // plus pour l'utilisateur courant (ex. conversation retirée) : on ne laisse pas
    // l'ancienne conversation affichée sous le nouvel utilisateur, et on
    // arrête de la considérer comme "active" pour les notifications.
    state.activeConversationId = null;
    if (messageList) {
      messageList.innerHTML = '';
    }
    afficherAucuneConversation();
    definirConversationActivePourNotifs(null);
    reinitialiserHistoriqueDm();
    // Voir le commentaire équivalent plus haut : activeConversationId
    // vient d'être remis à null, composerAutorise doit être recalculé en
    // conséquence.
    afficherEtatReseau();
    return;
  }

  // On rappelle explicitement afficherEtatReseau() ici : composerAutorise
  // (voir sa définition plus haut) est calculé à partir de
  // state.activeConversationId, qui vient potentiellement d'être fixé par
  // un appelant qui ne passe PAS par refreshConversations() (ex. un clic
  // direct sur une conversation dans la liste, ou un changement de filtre
  // — voir leurs listeners plus bas) — refreshConversations() rappelle
  // bien afficherEtatReseau() de son côté, mais ces deux-là appellent
  // renderActiveConversation() directement. Sans cet appel ici,
  // composerAutorise resterait figé sur sa dernière valeur connue (par ex.
  // désactivé s'il n'y avait provisoirement aucune conversation active),
  // même après qu'une conversation valide soit redevenue active — voir
  // afficherEtatReseau() dans renderer.js (afficherMessages()) pour
  // l'équivalent salon et le même raisonnement.
  afficherEtatReseau();

  // Changement de conversation active : on repart d'un historique manuel
  // vide (voir chargerMessagesPlusAnciensDm et reinitialiserHistoriqueDm).
  // `finHistorique` part de la page récente tout juste reçue
  // (conversation.finHistorique, voir obtenirConversationsPrivees côté
  // RealGatewayRuntime.js) — même logique que etatHistoriqueSalon dans
  // renderer.js (voir son commentaire équivalent).
  if (etatHistoriqueDm.conversationId !== conversation.id) {
    // Avant le marquage comme lu plus bas, qui remet le compteur à zéro.
    separateurDm = {
      conversationId: conversation.id,
      nonLus: NotifPrefs.nombreNonLus('prive', conversation.id),
    };
    void chargerLecturesDm(conversation.id);
    etatHistoriqueDm = {
      conversationId: conversation.id,
      messagesAnciens: [],
      finHistorique: Boolean(conversation.finHistorique),
      enChargement: false,
    };
  } else if (etatHistoriqueDm.messagesAnciens.length === 0) {
    etatHistoriqueDm.finHistorique = Boolean(conversation.finHistorique);
  }

  // La conversation affichée est "lue" — mais SEULEMENT si la fenêtre a
  // effectivement le focus en ce moment (fenetreEstFocusee) : voir le
  // commentaire équivalent dans renderer.js (afficherMessages()) pour le
  // pourquoi (sinon ce rond de notification et la vraie notification
  // système de main.js, qui exige déjà le focus pour la même décision,
  // finissent en désaccord).
  if (fenetreEstFocusee) {
    NotifPrefs.marquerLu(window.electronAPI, 'prive', conversation.id, {
      estAffichee: () =>
        fenetreEstFocusee && state.activeConversationId === conversation.id,
      surChangement: () => {
        renderConversationList();
        mettreAJourBadgeApplication();
      },
    });
  }
  // La conversation "active" que main.js ne doit pas notifier (voir
  // showMessageNotification côté main.js) reste définie qu'on ait le
  // focus ou non : c'est elle qui est affichée à l'écran.
  definirConversationActivePourNotifs(conversation.id);

  // Page récente (conversation.messages) + historique manuellement remonté
  // (voir chargerMessagesPlusAnciensDm) : voir fusionnerHistoriqueDm plus
  // haut. Les messages non livrés de cette conversation (voir
  // messagesEnAttenteDm) sont fusionnés puis triés avec le reste par
  // `envoi` plutôt que simplement ajoutés à la suite : ils ne sont PAS
  // garantis d'être les plus récents — voir le commentaire équivalent sur
  // tousLesMessages dans renderer.js pour le détail du pourquoi (un
  // message réel plus récent peut arriver via refreshConversations()
  // pendant qu'un brouillon plus ancien attend encore, ou deux brouillons
  // peuvent être retentés dans le désordre).
  const messagesEnAttenteDeLaConversation = obtenirMessagesEnAttenteDm(
    conversation.id
  );
  const messagesHistorique = fusionnerHistoriqueDm(
    etatHistoriqueDm.messagesAnciens,
    conversation.messages ?? []
  );
  // fusionnerHistoriqueDm() renvoie déjà un tableau trié par `envoi` : pas
  // besoin de re-trier l'ensemble à chaque rendu quand il n'y a aucun
  // message en attente (le cas de loin le plus fréquent). Quand il y en a,
  // on fusionne au lieu de tout retrier — voir
  // fusionnerAvecMessagesEnAttenteDm ci-dessus et son équivalent salon dans
  // renderer.js.
  const messages = fusionnerAvecMessagesEnAttenteDm(
    messagesHistorique,
    messagesEnAttenteDeLaConversation
  );
  const otherUser = conversation.otherUser;

  if (topbarName) {
    topbarName.textContent =
      ChatUiShared.nomAffiche(otherUser) || t('dm.defaultUser');
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
    topbarAvatar.classList.remove('sans-presence');
    ChatUiShared.remplirAvatar(topbarAvatar, otherUser?.avatar);
  }
  if (typingIndicator && isTypingNom) {
    // Dans un DM, une seule autre personne peut potentiellement écrire
    // (contrairement à un salon) — son nom est donc fixé une fois ici, à
    // l'ouverture de la conversation, plutôt que recalculé à chaque
    // battement de actualiserIndicateurSaisie() (qui ne gère, lui, que le
    // show/hide selon l'état de saisie réel — voir plus bas).
    isTypingNom.textContent =
      ChatUiShared.nomAffiche(otherUser) || t('dm.defaultUser');
  }

  // Mémorise la position de défilement AVANT de reconstruire la liste :
  // voir le commentaire équivalent dans afficherMessages() (renderer.js)
  // pour le pourquoi (sans ça, un chargement de messages plus anciens
  // ferait sauter la vue tout en haut).
  const hauteurAvant = messageList.scrollHeight;
  const scrollAvant = messageList.scrollTop;

  messageList.innerHTML = '';

  if (messages.length === 0) {
    // Conversation réellement vide : voir le commentaire équivalent dans
    // afficherMessages() (renderer.js) pour le pourquoi on n'affiche pas la
    // barre d'historique dans ce cas précis.
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

  messageList.appendChild(
    creerStatutHistoriqueDm(etatHistoriqueDm, () =>
      chargerMessagesPlusAnciensDm()
    )
  );

  const indexNonLu = LogiqueInterface.indexSeparateur(
    messages,
    separateurDm,
    state.currentUserId
  );
  // Jusqu'où l'interlocuteur a lu (connu une fois les lectures chargées).
  const lecturesConnues = lecturesDm.conversationId === conversation.id;
  const luJusqua = lecturesConnues ? lecturesDm.luJusqua : null;
  // « Distribué » / « Lu à … » sous mon dernier message, s'il est le dernier
  // de la conversation (comme iMessage).
  const dernierLivre = messages.filter((message) => !message.nonLivre).at(-1);
  const ligneSous =
    lecturesConnues && dernierLivre?.auteurId === state.currentUserId
      ? dernierLivre.id
      : null;

  messages.forEach((message, index) => {
    if (index === indexNonLu) {
      messageList.appendChild(ChatUiShared.creerSeparateurNonLus(t));
    }
    const row = document.createElement('article');
    const isOwn = message.auteurId === state.currentUserId;
    const author = isOwn
      ? t('dm.me')
      : ChatUiShared.nomAffiche(otherUser) || t('dm.defaultUser');
    const timeLabel = new Date(message.envoi).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    row.classList.add('message-row');
    row.dataset.messageId = message.id;
    if (ChatUiShared.estMessageCible(message.id)) {
      row.classList.add('message-cible');
    }
    if (isOwn) {
      row.classList.add('own-message');
    }
    if (message.nonLivre) {
      row.classList.add('non-livre');
    }

    const avatar = document.createElement('div');
    avatar.classList.add('avatar');
    ChatUiShared.remplirAvatar(
      avatar,
      isOwn ? state.preferences?.avatar : otherUser?.avatar
    );

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
    remplirTexteMessage(text, message.contenu);

    meta.append(authorEl, timeEl);
    if (message.modification) {
      const edited = document.createElement('span');
      edited.classList.add('edited-label');
      edited.textContent = `(${t('messages.edited')})`;
      meta.appendChild(edited);
    }
    const statut = LogiqueInterface.statutLecture(
      message.envoi,
      luJusqua,
      message.id,
      lecturesDm.dernierMessageLuId
    );
    if (isOwn && !message.nonLivre) {
      meta.appendChild(ChatUiShared.creerStatutLecture(statut, t));
    }
    body.append(meta, text);
    if (message.id === ligneSous) {
      body.appendChild(
        ChatUiShared.creerLigneLecture(
          statut === 'lu'
            ? t('readReceipts.readAt', {
                time: new Date(luJusqua).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })
            : t('readReceipts.delivered')
        )
      );
    }
    if (message.nonLivre) {
      body.appendChild(creerActionsMessageNonLivre(message));
    } else if (isOwn) {
      body.appendChild(creerActionsMessage(message, text));
    }
    row.append(avatar, body);
    messageList.appendChild(row);
  });

  if (garderScroll) {
    messageList.scrollTop = scrollAvant;
  } else if (conserverPositionScroll) {
    // Charger plus ancien insère du contenu EN HAUT de la liste : voir le
    // commentaire équivalent dans afficherMessages() (renderer.js) pour le
    // pourquoi de ce recalcul.
    messageList.scrollTop =
      messageList.scrollHeight - hauteurAvant + scrollAvant;
  } else {
    messageList.scrollTop = messageList.scrollHeight;
  }
}

/**
 * Charge la page de messages plus anciens qui précède ceux déjà affichés
 * pour la conversation active (pagination "charger plus ancien" — voir
 * obtenirMessagesPriveesAvant côté RealGatewayRuntime.js), et les fusionne
 * dans etatHistoriqueDm avant de redemander un rendu qui préserve la
 * position de défilement. Voir chargerMessagesPlusAnciensSalon dans
 * renderer.js pour l'équivalent salon (même garde-fous : pas d'effet si un
 * chargement est déjà en cours, si l'historique de la conversation active
 * est déjà entièrement remonté, ou si aucune conversation n'est active).
 */
function creerActionsMessage(message, texteEl) {
  return ChatUiShared.creerActionsMessage({
    message,
    texteEl,
    api: window.electronAPI,
    utilisateurId: () => state.currentUserId,
    t,
    notifier,
    messageErreur,
    champMessage: messageInput,
    getEtatReseau: () => etatReseau,
  });
}

function creerActionsMessageNonLivre(message) {
  return ChatUiShared.creerActionsMessageNonLivre({
    message,
    t,
    enCours: messagesEnAttenteEnCoursDm.has(message.id),
    onReessayer: reessayerMessageEnAttenteDm,
    onSupprimer: supprimerMessageEnAttenteDm,
  });
}

async function chargerMessagesPlusAnciensDm({ taille } = {}) {
  const conversation = state.conversations.find(
    (entry) => entry.id === state.activeConversationId
  );
  if (
    !conversation ||
    etatHistoriqueDm.conversationId !== conversation.id ||
    etatHistoriqueDm.enChargement ||
    etatHistoriqueDm.finHistorique
  ) {
    return false;
  }

  const plusAncienCharge =
    etatHistoriqueDm.messagesAnciens[0] ?? conversation.messages?.[0];

  etatHistoriqueDm.enChargement = true;
  await renderActiveConversation({ conserverPositionScroll: true });

  try {
    const resultat = await window.electronAPI.obtenirMessagesPriveesAvant({
      conversationId: conversation.id,
      utilisateurId: state.currentUserId,
      avantId: plusAncienCharge?.id,
      ...(taille ? { taille } : {}),
    });
    if (etatHistoriqueDm.conversationId !== conversation.id) {
      return false;
    }
    etatHistoriqueDm.messagesAnciens = fusionnerHistoriqueDm(
      etatHistoriqueDm.messagesAnciens,
      resultat.messages
    );
    etatHistoriqueDm.finHistorique = resultat.finHistorique;
    return true;
  } catch (erreur) {
    notifier(messageErreur(erreur), true);
    return false;
  } finally {
    if (etatHistoriqueDm.conversationId === conversation.id) {
      etatHistoriqueDm.enChargement = false;
      await renderActiveConversation({ conserverPositionScroll: true });
    }
  }
}

/**
 * Accusé de lecture de la conversation `conversationId` (jusqu'où
 * l'interlocuteur l'a lue), puis nouveau rendu si elle est toujours
 * affichée. Best-effort : sans réponse, les messages restent « distribués ».
 */
async function chargerLecturesDm(conversationId) {
  const generation = ++generationLecturesDm;
  const etat = { conversationId, luJusqua: null };
  lecturesDm = etat;
  try {
    const { lecteurs } = await window.electronAPI.obtenirLectures({
      type: 'prive',
      conversationId,
    });
    if (
      generation !== generationLecturesDm ||
      state.activeConversationId !== conversationId ||
      lecturesDm.conversationId !== conversationId
    )
      return;
    lecturesDm = {
      conversationId,
      ...LogiqueInterface.fusionnerLecture(lecturesDm, lecteurs[0] ?? etat),
    };
    await renderActiveConversation({ garderScroll: true });
  } catch (erreur) {
    console.warn('[lectures] accusé de lecture indisponible :', erreur);
  }
}

/**
 * Accusé de lecture reçu en temps réel. Lu depuis un de mes autres
 * appareils : les compteurs sont relus. Lu par l'interlocuteur de la
 * conversation affichée : ses ✓ passent à ✓✓.
 */
async function appliquerLecture(lecture) {
  if (lecture?.deMoi) {
    await NotifPrefs.chargerNonLus(window.electronAPI);
    renderConversationList();
    await actualiserBadgeSalons({ recharger: false });
    mettreAJourBadgeApplication();
    return;
  }
  if (
    lecture?.type !== 'prive' ||
    lecture.conversationId !== state.activeConversationId ||
    lecturesDm.conversationId !== lecture.conversationId
  ) {
    return;
  }
  lecturesDm = {
    conversationId: lecture.conversationId,
    ...LogiqueInterface.fusionnerLecture(lecturesDm, lecture),
  };
  await renderActiveConversation({ garderScroll: true });
}

// Saut vers un message ancien (résultat de recherche) : pages plus grandes
// que la pagination normale, et un plafond pour un très long historique.
const TAILLE_PAGE_SAUT_DM = 100;
const PAGES_MAX_SAUT_DM = 20;

/**
 * Affiche le message `messageId` de la conversation affichée : charge
 * l'historique plus ancien jusqu'à lui (sans trou, comme « Charger plus »),
 * puis défile jusqu'à lui et le met en évidence.
 */
async function allerAuMessageDm(messageId) {
  const estCharge = () => {
    const conversation = trouverConversation(state.activeConversationId);
    return Boolean(
      conversation &&
      (LogiqueInterface.contientMessage(
        conversation.messages ?? [],
        messageId
      ) ||
        (etatHistoriqueDm.conversationId === conversation.id &&
          LogiqueInterface.contientMessage(
            etatHistoriqueDm.messagesAnciens,
            messageId
          )))
    );
  };
  for (let page = 0; !estCharge() && page < PAGES_MAX_SAUT_DM; page += 1) {
    if (!(await chargerMessagesPlusAnciensDm({ taille: TAILLE_PAGE_SAUT_DM })))
      break;
  }
  if (!ChatUiShared.allerAuMessageAffiche(messageList, messageId)) {
    notifier(t('search.messageNotFound'), true);
  }
}
