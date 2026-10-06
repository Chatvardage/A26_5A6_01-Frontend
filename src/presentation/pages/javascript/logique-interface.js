'use strict';
/**
 * Logique PURE des pages de chat (salons et messages privés) : aucune
 * dépendance au DOM, au réseau ni à Electron, pour pouvoir être testée à
 * 100 % (voir logique-interface.test.ts). Les pages (renderer/*.js,
 * message-prive.js) gardent l'affichage et appellent ces fonctions.
 *
 * Script classique (pas de bundler pour ces pages, voir l'en-tête de
 * i18n-browser.js) : exposé sous globalThis.LogiqueInterface (= window dans
 * les pages), où les tests le lisent aussi.
 */
(function (racine) {
  // --- Messages ----------------------------------------------------------

  /**
   * Page récente + historique remonté à la main : fusion sans doublon (le
   * plus récent l'emporte pour un même id), triée par `champDate`.
   */
  function fusionnerHistorique(messagesAnciens, messagesRecents, champDate) {
    const parId = new Map();
    [...messagesAnciens, ...messagesRecents].forEach((message) => {
      parId.set(message.id, message);
    });
    return Array.from(parId.values()).sort(
      (a, b) => a[champDate] - b[champDate]
    );
  }

  /**
   * Fusionne `messagesTries` (déjà trié par `champDate`) avec les brouillons
   * non livrés, sans retrier tout l'historique : les pages redessinent très
   * souvent (indicateur de saisie…), un tri complet à chaque fois coûterait
   * O(n log n) pour 0 à 2 brouillons. Tri des seuls brouillons, puis fusion
   * linéaire des deux listes triées.
   */
  function fusionnerAvecMessagesEnAttente(
    messagesTries,
    messagesEnAttente,
    champDate
  ) {
    if (!messagesEnAttente.length) return messagesTries;
    const brouillonsTries = [...messagesEnAttente].sort(
      (a, b) => a[champDate] - b[champDate]
    );
    const resultat = [];
    let i = 0;
    let j = 0;
    while (i < messagesTries.length && j < brouillonsTries.length) {
      if (messagesTries[i][champDate] <= brouillonsTries[j][champDate]) {
        resultat.push(messagesTries[i++]);
      } else {
        resultat.push(brouillonsTries[j++]);
      }
    }
    while (i < messagesTries.length) resultat.push(messagesTries[i++]);
    while (j < brouillonsTries.length) resultat.push(brouillonsTries[j++]);
    return resultat;
  }

  function contientMessage(messages, messageId) {
    return (messages ?? []).some((message) => message.id === messageId);
  }

  /** Ajoute un message reçu/envoyé (sans doublon), liste triée par date. */
  function ajouterMessage(messages, message, champDate) {
    const liste = messages ?? [];
    if (contientMessage(liste, message.id)) return liste;
    return [...liste, message].sort((a, b) => a[champDate] - b[champDate]);
  }

  /** Message modifié : fusionné dans sa version existante (même id). */
  function remplacerMessage(messages, message) {
    return (messages ?? []).map((existant) =>
      existant.id === message.id ? { ...existant, ...message } : existant
    );
  }

  function retirerMessage(messages, messageId) {
    return (messages ?? []).filter((message) => message.id !== messageId);
  }

  // --- Défilement --------------------------------------------------------

  // En dessous de cette distance du bas, on « suit » la conversation.
  const SEUIL_PRES_DU_BAS_PX = 80;

  /** Vrai si la liste (scrollHeight/scrollTop/clientHeight) est presque en
   * bas. Sans liste, on considère qu'on suit la conversation. */
  function estPresDuBas(liste, seuil = SEUIL_PRES_DU_BAS_PX) {
    if (!liste) return true;
    return liste.scrollHeight - liste.scrollTop - liste.clientHeight <= seuil;
  }

  /**
   * Un nouveau message ne fait défiler la liste que s'il est dans la
   * conversation affichée ET qu'on en est l'auteur ou qu'on était déjà en
   * bas : sinon, quelqu'un qui relit l'historique (ou un message d'une autre
   * conversation) était ramené tout en bas à chaque message reçu.
   */
  function doitSuivreNouveauMessage({
    dansConversationAffichee,
    estAuteur,
    presDuBas,
  }) {
    return Boolean(dansConversationAffichee && (estAuteur || presDuBas));
  }

  // --- Listes -----------------------------------------------------------

  /** Conversations privées : activité la plus récente en premier. */
  function trierConversations(conversations) {
    const date = (conversation) =>
      conversation.lastMessage?.envoi ?? conversation.messages?.[0]?.envoi ?? 0;
    return [...conversations].sort((a, b) => date(b) - date(a));
  }

  // --- Contenu du serveur par défaut --------------------------------------
  // Créé par migration avec des identifiants figés (Room-Service
  // 20260924100000_serveurs, Message-Service 20260924110000_message_bienvenue)
  // : affiché dans la langue de l'app tant qu'il n'a pas été renommé/modifié.
  const SALONS_PAR_DEFAUT = {
    '00000000-0000-4000-8000-000000000002': {
      nomOriginal: 'annonces',
      cle: 'channels.defaultAnnouncements',
    },
    '00000000-0000-4000-8000-000000000003': {
      nomOriginal: 'général',
      cle: 'channels.defaultGeneral',
    },
  };
  const MESSAGE_BIENVENUE_ID = '00000000-0000-4000-8000-000000000101';

  /** Clé de traduction du nom d'un salon par défaut, ou null (nom saisi par
   * un utilisateur, jamais traduit). */
  function cleNomSalon(salon) {
    const parDefaut = SALONS_PAR_DEFAUT[salon.id];
    return parDefaut && salon.nom === parDefaut.nomOriginal
      ? parDefaut.cle
      : null;
  }

  /** Clé de traduction du contenu d'un message (bienvenue non modifié), ou
   * null (contenu affiché tel quel). */
  function cleContenuMessage(message) {
    return message.id === MESSAGE_BIENVENUE_ID && !message.modification
      ? 'channels.welcomeMessage'
      : null;
  }

  // --- Recherche de messages ---------------------------------------------

  /** Longueurs acceptées par Message-Service (GET /api/messages/search). */
  const LONGUEUR_MIN_RECHERCHE = 2;
  const LONGUEUR_MAX_RECHERCHE = 100;

  /** Vrai si `texte` (espaces retirés) peut être cherché. */
  function peutRechercher(texte) {
    const longueur = String(texte ?? '').trim().length;
    return (
      longueur >= LONGUEUR_MIN_RECHERCHE && longueur <= LONGUEUR_MAX_RECHERCHE
    );
  }

  /**
   * Extrait de `texte` centré sur la première occurrence de `terme` (casse
   * ignorée), d'au plus `rayon` caractères de chaque côté, avec « … » aux
   * coupures. Texte entier s'il est court ou si le terme est absent (début).
   */
  function extraitAutour(texte, terme, rayon = 60) {
    const source = String(texte ?? '');
    if (source.length <= rayon * 2) return source;
    const position = source
      .toLocaleLowerCase()
      .indexOf(String(terme ?? '').toLocaleLowerCase());
    const debut = Math.max(0, (position < 0 ? 0 : position) - rayon);
    const fin = Math.min(
      source.length,
      debut + rayon * 2 + String(terme ?? '').length
    );
    return `${debut > 0 ? '…' : ''}${source.slice(debut, fin)}${fin < source.length ? '…' : ''}`;
  }

  /**
   * Découpe `texte` en segments `{ texte, surligne }` : chaque occurrence de
   * `terme` (casse ignorée) est surlignée. Les pages en font des nœuds texte
   * et <mark>, jamais du HTML.
   */
  function decouperSurligne(texte, terme) {
    const source = String(texte ?? '');
    const cherche = String(terme ?? '').toLocaleLowerCase();
    if (!cherche) return source ? [{ texte: source, surligne: false }] : [];
    const minuscule = source.toLocaleLowerCase();
    const segments = [];
    let depuis = 0;
    let position = minuscule.indexOf(cherche);
    while (position >= 0) {
      if (position > depuis) {
        segments.push({
          texte: source.slice(depuis, position),
          surligne: false,
        });
      }
      segments.push({
        texte: source.slice(position, position + cherche.length),
        surligne: true,
      });
      depuis = position + cherche.length;
      position = minuscule.indexOf(cherche, depuis);
    }
    if (depuis < source.length) {
      segments.push({ texte: source.slice(depuis), surligne: false });
    }
    return segments;
  }

  racine.LogiqueInterface = Object.freeze({
    fusionnerHistorique,
    fusionnerAvecMessagesEnAttente,
    contientMessage,
    ajouterMessage,
    remplacerMessage,
    retirerMessage,
    SEUIL_PRES_DU_BAS_PX,
    estPresDuBas,
    doitSuivreNouveauMessage,
    trierConversations,
    SALONS_PAR_DEFAUT,
    MESSAGE_BIENVENUE_ID,
    cleNomSalon,
    cleContenuMessage,
    LONGUEUR_MIN_RECHERCHE,
    LONGUEUR_MAX_RECHERCHE,
    peutRechercher,
    extraitAutour,
    decouperSurligne,
  });
})(globalThis);
