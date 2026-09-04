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
  };
})(window);
