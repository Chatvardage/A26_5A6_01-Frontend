'use strict';

/**
 * Préférences de notification, partagées entre index.html (renderer.js) et
 * message-prive.html (message-prive.js). Chargé comme script classique
 * (pas un module) AVANT ces deux fichiers, pour exposer `window.NotifPrefs`
 * comme un global simple utilisable depuis un script classique comme depuis
 * un module — évite de dupliquer cette logique dans les deux fichiers (voir
 * le bug historique de schéma d'ID de conversation dupliqué entre
 * MockGateway.ts et MockGatewayRuntime.js : une même règle codée à deux
 * endroits finit par diverger).
 *
 * Trois modes, mutuellement exclusifs, réglables par utilisateur simulé :
 *  - 'systeme' : notification native du système (+ son, voir main.js), PLUS
 *    le petit rond (comme 'discret' ci-dessous) ;
 *  - 'discret' : aucune notification système, seulement le petit rond sur
 *    la conversation concernée (salon, icône de serveur, conversation
 *    privée) ;
 *  - 'aucune'  : rien du tout, ni notification système ni rond.
 *
 * Le rond est donc affiché dès que le mode n'est pas 'aucune' — voir
 * afficheRonds() ci-dessous, à utiliser plutôt que de comparer directement à
 * MODE_DISCRET pour décider si un rond doit apparaître.
 *
 * Le mode et l'état "lu/non lu" sont stockés dans localStorage (partagé
 * entre les deux pages puisqu'elles sont chargées depuis la même origine
 * file://, comme `sessionStorage.currentUserId` l'est déjà ailleurs dans
 * l'app) plutôt que dans le MockGateway : ce sont des préférences purement
 * côté UI, propres à chaque utilisateur simulé sur cette machine, pas des
 * données de conversation à synchroniser avec le "serveur".
 */
(function (global) {
  const MODE_SYSTEME = 'systeme';
  const MODE_DISCRET = 'discret';
  const MODE_AUCUNE = 'aucune';
  const MODES = [MODE_SYSTEME, MODE_DISCRET, MODE_AUCUNE];
  const MODE_PAR_DEFAUT = MODE_SYSTEME;

  function clefMode(utilisateurId) {
    return `notif:mode:${utilisateurId}`;
  }

  function clefLecture(utilisateurId) {
    return `notif:lecture:${utilisateurId}`;
  }

  function obtenirMode(utilisateurId) {
    if (!utilisateurId) return MODE_PAR_DEFAUT;
    try {
      const valeur = global.localStorage.getItem(clefMode(utilisateurId));
      return MODES.includes(valeur) ? valeur : MODE_PAR_DEFAUT;
    } catch {
      // localStorage indisponible (ex. mode privé restrictif) : on retombe
      // sur le comportement historique de l'app (notification système).
      return MODE_PAR_DEFAUT;
    }
  }

  /**
   * Vrai si le rond de notification doit être affiché pour cet utilisateur,
   * c'est-à-dire tant que son mode n'est pas 'aucune' (donc en 'systeme'
   * comme en 'discret' — seul 'aucune' masque le rond).
   */
  function afficheRonds(utilisateurId) {
    return obtenirMode(utilisateurId) !== MODE_AUCUNE;
  }

  function definirMode(utilisateurId, mode) {
    if (!utilisateurId || !MODES.includes(mode)) return;
    try {
      global.localStorage.setItem(clefMode(utilisateurId), mode);
    } catch {
      // Best-effort : si le stockage échoue, la préférence ne persistera
      // pas au prochain démarrage, mais ça ne doit pas casser l'app.
    }
  }

  function obtenirCarteLecture(utilisateurId) {
    try {
      const brut = global.localStorage.getItem(clefLecture(utilisateurId));
      const carte = brut ? JSON.parse(brut) : null;
      return carte && typeof carte === 'object' ? carte : {};
    } catch {
      return {};
    }
  }

  function marquerCommeLu(utilisateurId, conversationId, timestamp) {
    if (!utilisateurId || !conversationId) return;
    const carte = obtenirCarteLecture(utilisateurId);
    carte[conversationId] = timestamp ?? Date.now();
    try {
      global.localStorage.setItem(
        clefLecture(utilisateurId),
        JSON.stringify(carte)
      );
    } catch {
      // Best-effort, voir definirMode() ci-dessus.
    }
  }

  /**
   * Indique si `conversationId` a une activité non lue pour `utilisateurId`.
   * @param {string} utilisateurId
   * @param {string} conversationId
   * @param {{auteurId: string, timestamp: number}|null|undefined} dernierMessage
   *   Le dernier message connu de la conversation (peu importe salon ou DM,
   *   l'appelant normalise déjà la forme). `null`/`undefined` si la
   *   conversation n'a aucun message.
   */
  function estNonLu(utilisateurId, conversationId, dernierMessage) {
    if (!utilisateurId || !conversationId || !dernierMessage) return false;
    // Mon propre dernier message ne compte jamais comme "non lu" pour moi.
    if (dernierMessage.auteurId === utilisateurId) return false;
    const carte = obtenirCarteLecture(utilisateurId);
    const derniereLecture = carte[conversationId] ?? 0;
    return (dernierMessage.timestamp ?? 0) > derniereLecture;
  }

  // --- Badge d'icône d'application (partagé renderer.js / message-prive.js) --
  // Ces fonctions vivaient auparavant en double dans renderer.js ET
  // message-prive.js (copiées-collées à l'identique) — exactement le genre de
  // risque de divergence décrit dans le commentaire en tête de ce fichier.
  // Elles vivent maintenant ici, seul endroit partagé entre les deux pages.

  /** Le dernier message d'un salon (forme `{ messages: [...] }`), normalisé
   * pour estNonLu()/compterSalonsNonLus(). */
  function dernierMessageSalon(salon) {
    const messages = salon?.messages;
    if (!messages || !messages.length) return null;
    const dernier = messages[messages.length - 1];
    return { auteurId: dernier.auteurId, timestamp: dernier.date };
  }

  /** Le dernier message d'une conversation privée (forme `{ lastMessage }`),
   * normalisé pour estNonLu()/compterConversationsNonLues(). */
  function dernierMessageConversation(conversation) {
    const dernier = conversation?.lastMessage;
    if (!dernier) return null;
    return { auteurId: dernier.auteurId, timestamp: dernier.envoi };
  }

  /** Nombre de salons non lus pour `utilisateurId` parmi `salons`. */
  function compterSalonsNonLus(utilisateurId, salons) {
    return (salons ?? []).reduce(
      (total, salon) =>
        estNonLu(utilisateurId, salon.id, dernierMessageSalon(salon))
          ? total + 1
          : total,
      0
    );
  }

  /** Nombre de conversations privées non lues pour `utilisateurId` parmi
   * `conversations`. */
  function compterConversationsNonLues(utilisateurId, conversations) {
    return (conversations ?? []).reduce(
      (total, conversation) =>
        estNonLu(
          utilisateurId,
          conversation.id,
          dernierMessageConversation(conversation)
        )
          ? total + 1
          : total,
      0
    );
  }

  /**
   * Dessine un petit badge numérique (cercle rouge + chiffre blanc) dans un
   * canvas hors-écran. Utilisé uniquement pour la superposition d'icône
   * Windows (setOverlayIcon dans main.js), qui exige une image plutôt qu'un
   * simple nombre — contrairement à app.setBadgeCount (macOS/Linux), qui
   * affiche directement un chiffre sans qu'on ait à le dessiner.
   */
  function genererIconeBadge(nombre) {
    const texte = nombre > 9 ? '9+' : String(nombre);
    const taille = 32;
    const canvas = global.document.createElement('canvas');
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
   * Envoie `nombre` à `serviceNotifications.setBadgeCount` (voir preload.js /
   * main.js), en générant l'icône de superposition Windows seulement si
   * nombre > 0. `serviceNotifications` est passé en paramètre plutôt que lu
   * depuis un global : renderer.js et message-prive.js exposent chacun leur
   * propre référence locale à window.notifications.
   */
  function appliquerBadge(serviceNotifications, nombre) {
    if (typeof serviceNotifications?.setBadgeCount !== 'function') return;
    serviceNotifications.setBadgeCount(
      nombre,
      nombre > 0 ? genererIconeBadge(nombre) : null
    );
  }

  // --- Traitement d'un message de démo simulé (main.js) -----------------
  // Corps partagé du handler `onMockMessage` de renderer.js et
  // message-prive.js : log de diagnostic, résolution du mode NotifPrefs de
  // l'utilisateur actuellement affiché, et décision de déclencher ou non une
  // notification système. Seule la partie "quoi rafraîchir à l'écran" diffère
  // réellement entre les deux pages (une page affiche les salons, l'autre les
  // conversations privées) — elle reste donc du ressort de l'appelant, via
  // les callbacks `surSalon`/`surPrive`.
  async function traiterMessageSimule(message, options) {
    const { utilisateurId, surSalon, surPrive, notifierMessageSysteme } =
      options ?? {};
    try {
      const mode = obtenirMode(utilisateurId);
      // Log de diagnostic : lance l'app avec `NODE_ENV=development` pour voir
      // les DevTools et cette ligne dans la console si un message de démo
      // semble ne rien déclencher. Ne casse rien en production, où personne
      // ne regarde la console de toute façon.
      console.log(
        `[notifications:message-simule] reçu (type=${message.type}, auteur=${message.auteurId}, utilisateur courant=${utilisateurId}, mode=${mode})`
      );
      if (message.type === 'salon') {
        await surSalon?.();
      } else {
        await surPrive?.();
      }
      if (message.auteurId === utilisateurId) {
        console.log(
          '[notifications:message-simule] ignoré : auteur = utilisateur courant (jamais de notif pour son propre message).'
        );
      } else if (mode !== MODE_SYSTEME) {
        console.log(
          `[notifications:message-simule] pas de notification système : mode actuel = "${mode}" (seul le mode "systeme" en déclenche).`
        );
      } else {
        notifierMessageSysteme?.(message);
      }
    } catch (erreur) {
      console.error('[notifications:message-simule] ERREUR:', erreur);
    }
  }

  global.NotifPrefs = {
    MODE_SYSTEME,
    MODE_DISCRET,
    MODE_AUCUNE,
    MODES,
    obtenirMode,
    definirMode,
    afficheRonds,
    marquerCommeLu,
    estNonLu,
    dernierMessageSalon,
    compterSalonsNonLus,
    compterConversationsNonLues,
    genererIconeBadge,
    appliquerBadge,
    traiterMessageSimule,
  };
})(window);
