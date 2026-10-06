'use strict';

/**
 * Préférences de notification, partagées entre index.html (renderer.js) et
 * message-prive.html (message-prive.js). Chargé comme script classique
 * (pas un module) AVANT ces deux fichiers, pour exposer `window.NotifPrefs`
 * comme un global simple utilisable depuis un script classique comme depuis
 * un module — évite de dupliquer cette logique dans les deux fichiers (une
 * même règle codée à deux endroits finit par diverger).
 *
 * Trois modes, mutuellement exclusifs, réglables par utilisateur :
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
 * Le mode et l'aperçu sont stockés dans localStorage (partagé entre les
 * deux pages puisqu'elles sont chargées depuis la même origine file://), par
 * utilisateur connecté sur cette machine.
 *
 * Les messages non lus, eux, sont tenus par Message-Service (état de
 * lecture persistant, identique sur tous les appareils et après un
 * redémarrage) : cette page en garde une copie (voir « Compteurs de non-lus »
 * plus bas), chargée à l'ouverture et après chaque reconnexion, tenue à jour
 * par les messages reçus en temps réel.
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

  function clefApercu(utilisateurId) {
    return `notif:apercu:${utilisateurId}`;
  }

  /**
   * Vrai (par défaut) si le texte du message apparaît dans la notification
   * système. Désactivable : ces notifications sont visibles sur un écran
   * verrouillé. Préférence locale, comme le mode.
   */
  function afficheApercu(utilisateurId) {
    if (!utilisateurId) return true;
    try {
      return global.localStorage.getItem(clefApercu(utilisateurId)) !== 'non';
    } catch {
      return true;
    }
  }

  function definirApercu(utilisateurId, affiche) {
    if (!utilisateurId) return;
    try {
      global.localStorage.setItem(
        clefApercu(utilisateurId),
        affiche ? 'oui' : 'non'
      );
    } catch {
      // Best-effort, comme definirMode.
    }
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

  // --- Compteurs de non-lus (copie de l'état de Message-Service) -------------
  // Clés : identifiant de conversation de l'app (id de DM, id de salon).
  // Un message reçu d'autrui incrémente toujours le compteur de sa
  // conversation ; l'affichage de la conversation active (fenêtre au premier
  // plan) appelle ensuite marquerLu(), qui remet le compteur à zéro et
  // prévient le serveur. Ainsi, un message lu en direct est aussi lu côté
  // serveur, et un message reçu en arrière-plan reste compté.
  const compteurs = { salon: new Map(), prive: new Map() };
  const lecturesEnCours = { salon: new Set(), prive: new Set() };
  const rechargementsEnAttente = { salon: new Set(), prive: new Set() };
  let generationChargement = 0;
  let revisionCompteurs = 0;

  /** Remplace les compteurs par ceux du serveur, `{ salons, prives }`
   * (best-effort : en cas d'échec, les compteurs actuels sont gardés). */
  async function chargerNonLus(api) {
    const generation = ++generationChargement;
    try {
      // Relancer une fois si des réceptions ou lectures locales rendent
      // la réponse périmée; jamais écraser ces changements ni boucler
      // indéfiniment sur une conversation très active.
      for (let tentative = 0; tentative < 2; tentative += 1) {
        const revision = revisionCompteurs;
        const nonLus = await api.obtenirNonLus();
        if (generation !== generationChargement) return;
        if (revision !== revisionCompteurs) continue;
        for (const [type, source] of [
          ['salon', nonLus?.salons],
          ['prive', nonLus?.prives],
        ]) {
          for (const id of lecturesEnCours[type]) {
            rechargementsEnAttente[type].add(id);
          }
          for (const id of compteurs[type].keys()) {
            if (!lecturesEnCours[type].has(id)) compteurs[type].delete(id);
          }
          for (const [id, nombre] of Object.entries(source ?? {})) {
            if (nombre > 0 && !lecturesEnCours[type].has(id))
              compteurs[type].set(id, nombre);
          }
        }
        return;
      }
    } catch (erreur) {
      console.warn('[non-lus] compteurs indisponibles :', erreur);
    }
  }

  /** `type` : 'salon' ou 'prive'. */
  function nombreNonLus(type, conversationId) {
    return compteurs[type]?.get(conversationId) ?? 0;
  }

  /** Message reçu d'autrui dans `conversationId`. */
  function ajouterNonLu(type, conversationId) {
    if (!compteurs[type] || !conversationId) return;
    revisionCompteurs += 1;
    compteurs[type].set(conversationId, nombreNonLus(type, conversationId) + 1);
  }

  /**
   * Conversation affichée et lue : compteur à zéro, puis état enregistré
   * par le serveur. Rien n'est envoyé si elle n'avait aucun non-lu, pour
   * que chaque nouvel affichage ne coûte pas une requête.
   */
  function marquerLu(api, type, conversationId, options = {}) {
    const nombre = nombreNonLus(type, conversationId);
    if (!nombre || lecturesEnCours[type].has(conversationId)) return;
    revisionCompteurs += 1;
    lecturesEnCours[type].add(conversationId);
    compteurs[type].delete(conversationId);
    let reussi = false;
    Promise.resolve()
      .then(() => api.marquerConversationLue({ type, conversationId }))
      .then((reponse) => {
        reussi = true;
        revisionCompteurs += 1;
        const restants = Math.max(
          nombreNonLus(type, conversationId),
          reponse?.nonLus ?? 0
        );
        if (restants) compteurs[type].set(conversationId, restants);
      })
      .catch((erreur) => {
        revisionCompteurs += 1;
        // Restaurer aussi les messages arrivés pendant la requête.
        compteurs[type].set(
          conversationId,
          nombreNonLus(type, conversationId) + nombre
        );
        console.warn('[non-lus] marquage comme lu impossible :', erreur);
      })
      .finally(async () => {
        lecturesEnCours[type].delete(conversationId);
        const rechargementDemande =
          rechargementsEnAttente[type].delete(conversationId);
        const estAffichee = options.estAffichee?.() ?? false;
        // La réponse du PUT et les incréments locaux ne permettent pas de
        // savoir si un message reçu pendant la requête a été inclus par le
        // serveur. Relire sa valeur autoritaire évite aussi bien de le perdre
        // que de conserver un badge pour un message déjà marqué.
        if ((reussi && !estAffichee) || rechargementDemande) {
          await chargerNonLus(api);
        }
        options.surChangement?.();
        if (
          reussi &&
          nombreNonLus(type, conversationId) &&
          options.estAffichee?.()
        ) {
          marquerLu(api, type, conversationId, options);
        }
      });
  }

  /** Total des non-lus : tous types si `type` est absent, seulement
   * `conversationIds` s'il est fourni. */
  function totalNonLus({ type, conversationIds } = {}) {
    const types = type ? [type] : ['salon', 'prive'];
    let total = 0;
    for (const t of types) {
      const ids = conversationIds ?? [...compteurs[t].keys()];
      for (const id of ids) total += nombreNonLus(t, id);
    }
    return total;
  }

  /** Texte du compteur : « 99+ » au-delà de 99. */
  function libelleNonLus(nombre) {
    return nombre > 99 ? '99+' : String(nombre);
  }

  /** Affiche `nombre` dans l'élément compteur, masqué à zéro ou quand le
   * mode de notification est « aucune » (`visible` faux). */
  function remplirCompteur(element, nombre, visible = true) {
    if (!element) return;
    const affiche = visible && nombre > 0;
    element.hidden = !affiche;
    element.textContent = affiche ? libelleNonLus(nombre) : '';
  }

  // --- Badge d'icône d'application (partagé renderer.js / message-prive.js) --

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
    // Canvas indisponible : badge sans icône de superposition, plutôt
    // qu'une erreur qui interromprait l'affichage de la page.
    if (!ctx) return null;
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

  // --- Traitement d'un message reçu en temps réel ----------------------
  // Corps partagé du handler `onNouveauMessage` de salons/temps-reel.js et
  // message-prive.js : log de diagnostic, résolution du mode NotifPrefs de
  // l'utilisateur actuellement affiché, et décision de déclencher ou non une
  // notification système. Seule la partie "quoi rafraîchir à l'écran" diffère
  // réellement entre les deux pages (une page affiche les salons, l'autre les
  // conversations privées) — elle reste donc du ressort de l'appelant, via
  // les callbacks `surSalon`/`surPrive`.
  async function traiterMessageRecu(message, options) {
    const { utilisateurId, surSalon, surPrive, notifierMessageSysteme } =
      options ?? {};
    try {
      const mode = obtenirMode(utilisateurId);
      // Log de diagnostic : lance l'app avec `NODE_ENV=development` pour voir
      // les DevTools et cette ligne dans la console si un message de démo
      // semble ne rien déclencher. Ne casse rien en production, où personne
      // ne regarde la console de toute façon.
      console.log(
        `[notifications:message-recu] reçu (type=${message.type}, auteur=${message.auteurId}, utilisateur courant=${utilisateurId}, mode=${mode})`
      );
      if (message.type === 'salon') {
        await surSalon?.();
      } else {
        await surPrive?.();
      }
      if (message.auteurId === utilisateurId) {
        console.log(
          '[notifications:message-recu] ignoré : auteur = utilisateur courant (jamais de notif pour son propre message).'
        );
      } else if (mode !== MODE_SYSTEME) {
        console.log(
          `[notifications:message-recu] pas de notification système : mode actuel = "${mode}" (seul le mode "systeme" en déclenche).`
        );
      } else {
        // Contenu masqué si l'utilisateur l'a demandé (écran verrouillé) :
        // main.js affiche alors un texte générique à la place.
        notifierMessageSysteme?.(
          afficheApercu(utilisateurId)
            ? message
            : { ...message, contenu: '', apercuMasque: true }
        );
      }
    } catch (erreur) {
      console.error('[notifications:message-recu] ERREUR:', erreur);
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
    afficheApercu,
    definirApercu,
    chargerNonLus,
    nombreNonLus,
    ajouterNonLu,
    marquerLu,
    totalNonLus,
    libelleNonLus,
    remplirCompteur,
    genererIconeBadge,
    appliquerBadge,
    traiterMessageRecu,
  };
})(window);
