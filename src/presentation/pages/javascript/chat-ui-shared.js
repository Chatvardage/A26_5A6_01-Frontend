(function () {
  'use strict';

  // Compte à rebours "nouvelle tentative dans X s" : rafraîchi chaque
  // seconde tant qu'une tentative est planifiée (voir planifierReconnexion
  // dans RealGatewayRuntime.js, qui fournit `prochaineTentative`).
  let minuteurCompteARebours = null;

  function texteDetailReseau(etat, t) {
    if (etat.statut === 'connecte' || etat.statut === 'inconnu') return '';
    if (etat.cause === 'hors-ligne') return t('network.deviceOffline');
    if (etat.prochaineTentative) {
      const secondes = Math.max(
        0,
        Math.ceil((etat.prochaineTentative - Date.now()) / 1000)
      );
      return secondes > 0
        ? `${t('network.serverUnreachable')} · ${t('network.retryIn', { s: secondes })}`
        : t('network.retrying');
    }
    if (etat.statut === 'reconnexion') return t('network.retrying');
    return '';
  }

  function afficherEtatReseau({ etat, elements, t, composerAutorise = true }) {
    if (!etat) return;
    const {
      statutConnexion,
      libelleConnexion,
      detailConnexion,
      reessayer,
      messageInput,
      submitButton,
    } = elements;

    if (statutConnexion) {
      statutConnexion.dataset.state = etat.statut;
      statutConnexion.dataset.cause = etat.cause ?? '';
    }
    if (libelleConnexion) {
      const libelles = {
        connecte: t('network.connected'),
        deconnecte: t('network.disconnected'),
        reconnexion: t('network.reconnecting'),
      };
      libelleConnexion.textContent = libelles[etat.statut] ?? etat.statut;
    }

    const majDetail = () => {
      if (!detailConnexion) return;
      const texte = texteDetailReseau(etat, t);
      detailConnexion.textContent = texte;
      detailConnexion.hidden = !texte;
    };
    majDetail();
    if (minuteurCompteARebours) clearInterval(minuteurCompteARebours);
    minuteurCompteARebours = etat.prochaineTentative
      ? setInterval(majDetail, 1000)
      : null;

    // "Réessayer" n'a de sens que si une tentative est en attente : ni
    // connecté, ni machine hors ligne (rien à tenter tant que l'OS n'a pas
    // de réseau — la reconnexion repart d'elle-même à son retour).
    if (reessayer) {
      reessayer.hidden = !(
        (etat.statut === 'deconnecte' || etat.statut === 'reconnexion') &&
        etat.cause !== 'hors-ligne'
      );
    }

    // Le champ de message et son bouton d'envoi ne dépendent QUE de la
    // présence d'une conversation active (composerAutorise) : un message tapé
    // hors ligne reste envoyable depuis l'UI, il est simplement affiché
    // immédiatement comme "non livré" avec des actions supprimer/réessayer
    // tant que la connexion n'est pas revenue (voir creerMessageEnAttente et
    // creerActionsMessageNonLivre plus bas, et leur usage dans renderer.js /
    // message-prive.js). Ce composerBloque ne doit donc plus dépendre de
    // l'état réseau, contrairement aux autres contrôles ci-dessous qui
    // déclenchent, eux, un vrai aller-retour serveur.
    const composerBloque = !composerAutorise;
    if (messageInput) messageInput.disabled = composerBloque;
    if (submitButton) submitButton.disabled = composerBloque;

    const bloque = etat.statut !== 'connecte';
    document
      .querySelectorAll('[data-requires-network="true"]')
      .forEach((element) => {
        element.disabled = bloque;
      });
  }

  const DELAI_RECHERCHE_UTILISATEURS_MS = 250;

  /**
   * Sélecteur d'utilisateur réutilisable (nouveau message privé, invitation
   * dans un salon) : un champ de recherche, puis une liste qui affiche des
   * suggestions tant que le champ est vide, et les résultats de la recherche
   * par début de pseudo (GET /api/users/search) sinon.
   *
   * @param {object} options
   * @param {Function} options.t traduction
   * @param {Function} options.messageErreur traduction d'une erreur
   * @param {() => Promise<object[]>} options.obtenirSuggestions
   * @param {(texte: string) => Promise<object[]>} options.rechercher
   * @param {(user: object) => {libelle: string, desactive?: boolean}} options.decrireAction
   *   texte à droite de chaque ligne ; `desactive` grise la ligne (ex. déjà
   *   membre du salon)
   * @param {(user: object) => void} options.surChoix
   * @param {(user: object) => boolean} [options.garderSuggestion] filtre des
   *   suggestions (les résultats de recherche, eux, sont tous affichés)
   * @param {string} options.messageAucuneSuggestion
   * @returns {HTMLElement[]} éléments à insérer dans le dialogue ; le champ
   *   reçoit le focus au prochain tour de boucle
   */
  function creerSelecteurUtilisateurs({
    t,
    messageErreur,
    obtenirSuggestions,
    rechercher,
    decrireAction,
    surChoix,
    garderSuggestion = () => true,
    messageAucuneSuggestion,
  }) {
    let minuteur = null;
    // Numéro de la dernière requête lancée : une réponse arrivée après une
    // requête plus récente est ignorée (frappe rapide).
    let numero = 0;

    const champ = document.createElement('input');
    champ.type = 'search';
    champ.classList.add('dm-search');
    champ.maxLength = 20;
    champ.autocomplete = 'off';
    champ.placeholder = t('dm.searchPlaceholder');
    champ.setAttribute('aria-label', t('dm.searchPlaceholder'));

    const titreEl = document.createElement('p');
    titreEl.classList.add('choice-section-title');
    const listeEl = document.createElement('div');
    listeEl.classList.add('choice-list');
    listeEl.setAttribute('aria-live', 'polite');

    function creerLigne(user) {
      const nom = nomAffiche(user);
      const { libelle, desactive = false } = decrireAction(user);
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.classList.add('user-choice');
      bouton.disabled = desactive;

      const avatar = document.createElement('span');
      avatar.classList.add('avatar', 'small');
      avatar.classList.toggle('offline', !user.present);
      avatar.textContent = nom.charAt(0).toUpperCase();
      avatar.title = user.present ? t('dm.online') : t('dm.offline');
      remplirAvatar(avatar, user.avatar);

      const identite = document.createElement('span');
      identite.classList.add('user-choice-identity');
      const nomEl = document.createElement('strong');
      nomEl.textContent = nom;
      identite.appendChild(nomEl);
      if (user.alias) {
        const pseudoEl = document.createElement('small');
        pseudoEl.textContent = `@${user.pseudo}`;
        identite.appendChild(pseudoEl);
      }

      const action = document.createElement('span');
      action.classList.add('user-choice-action');
      action.textContent = libelle;

      bouton.append(avatar, identite, action);
      bouton.addEventListener('click', () => surChoix(user));
      return bouton;
    }

    function afficher({ titre = '', utilisateurs = [], messageVide }) {
      titreEl.textContent = titre;
      titreEl.hidden = !titre;
      if (!utilisateurs.length) {
        const vide = document.createElement('p');
        vide.classList.add('empty-state');
        vide.textContent = messageVide;
        listeEl.replaceChildren(vide);
        return;
      }
      listeEl.replaceChildren(...utilisateurs.map(creerLigne));
    }

    async function afficherSuggestions() {
      const n = ++numero;
      afficher({ messageVide: t('dm.searching') });
      let utilisateurs = [];
      try {
        utilisateurs = (await obtenirSuggestions()).filter(garderSuggestion);
      } catch {
        // Liste vide : la recherche reste disponible.
      }
      if (n !== numero) return;
      afficher({
        titre: t('dm.suggestionsTitle'),
        utilisateurs,
        messageVide: messageAucuneSuggestion,
      });
    }

    async function lancerRecherche(texte) {
      const n = ++numero;
      afficher({ messageVide: t('dm.searching') });
      try {
        const utilisateurs = await rechercher(texte);
        if (n !== numero) return;
        afficher({
          titre: t('dm.resultsTitle'),
          utilisateurs,
          messageVide: t('dm.noResults'),
        });
      } catch (erreur) {
        if (n !== numero) return;
        // 404 : Authentification pas encore à jour (route /search absente).
        afficher({
          messageVide: String(erreur?.message ?? '').includes('ERR_HTTP_404')
            ? t('dm.searchUnavailable')
            : messageErreur(erreur),
        });
      }
    }

    champ.addEventListener('input', () => {
      window.clearTimeout(minuteur);
      const texte = champ.value.trim();
      minuteur = window.setTimeout(
        () => (texte ? lancerRecherche(texte) : afficherSuggestions()),
        DELAI_RECHERCHE_UTILISATEURS_MS
      );
    });
    // Les dialogues sont des <form method="dialog"> : sans ça, Entrée les
    // fermerait. Entrée choisit plutôt le premier résultat disponible.
    champ.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      listeEl.querySelector('.user-choice:not(:disabled)')?.click();
    });

    void afficherSuggestions();
    window.setTimeout(() => champ.focus(), 0);
    return [champ, titreEl, listeEl];
  }

  /**
   * Nom affiché d'un utilisateur : son alias (nom d'affichage choisi dans
   * son profil, User-Config-Service) s'il en a un, sinon son pseudo.
   */
  function nomAffiche(utilisateur) {
    return utilisateur?.alias || utilisateur?.pseudo || '';
  }

  /**
   * Photo de profil dans un rond d'avatar existant (liste, messages,
   * membres…). Sans photo, l'élément garde son contenu (initiale ou dégradé).
   * Insère l'<img> en premier enfant pour ne pas écraser les autres
   * (pastille "non lu" des conversations privées, par exemple).
   */
  function remplirAvatar(element, avatar) {
    if (!element) return;
    let image = element.querySelector(':scope > img.avatar-img');
    if (!avatar) {
      image?.remove();
      element.classList.remove('has-photo');
      return;
    }
    if (!image) {
      image = document.createElement('img');
      image.className = 'avatar-img';
      image.alt = '';
      image.draggable = false;
      element.prepend(image);
    }
    if (image.getAttribute('src') !== avatar) image.src = avatar;
    element.classList.add('has-photo');
  }

  /**
   * Avatar de l'utilisateur connecté (panneau du bas) : photo de profil si
   * définie (préférence `avatar`, User-Config-Service), sinon l'initiale de
   * l'alias/pseudo, et une pastille verte (en ligne) ou rouge (hors ligne).
   * « En ligne » exige la présence 'en-ligne' ET une connexion réseau
   * établie : coupé du serveur, on n'est de fait plus joignable.
   */
  function afficherAvatarCourant({
    element,
    utilisateur,
    preferences,
    presences,
    etatReseau,
    t,
  }) {
    if (!element) return;
    const nom = preferences?.alias || utilisateur?.pseudo || '';
    const avatar = preferences?.avatar;
    if (avatar) {
      let image = element.querySelector('img');
      if (!image) {
        image = document.createElement('img');
        image.alt = '';
        image.draggable = false;
        element.replaceChildren(image);
      }
      if (image.getAttribute('src') !== avatar) image.src = avatar;
    } else {
      element.textContent = nom.charAt(0).toUpperCase();
    }

    if (!utilisateur || !etatReseau || etatReseau.statut === 'inconnu') {
      delete element.dataset.presence;
      element.removeAttribute('title');
      return;
    }
    const enLigne =
      etatReseau.statut === 'connecte' &&
      presences?.[utilisateur.id] === 'en-ligne';
    element.dataset.presence = enLigne ? 'en-ligne' : 'hors-ligne';
    element.title = enLigne ? t('network.online') : t('network.offline');
  }

  async function chargerEtatReseauEtPresences({ api, onEtat, onPresences }) {
    const [reseau, presences] = await Promise.all([
      api.obtenirEtatReseau(),
      api.obtenirPresences(),
    ]);
    onEtat(reseau);
    onPresences(presences);
    return { reseau, presences };
  }

  /** Bouton "Réessayer" de l'indicateur réseau (la présence se modifie
   * désormais depuis la page profil). */
  function brancherBoutonReessayer({ api, element, getEtatReseau, notifierErreur }) {
    element?.addEventListener('click', async () => {
      if (getEtatReseau()?.statut === 'connecte') return;
      try {
        await api.reessayerConnexion();
      } catch (erreur) {
        notifierErreur(erreur);
      }
    });
  }

  // --- Rôles dans un serveur ---------------------------------------------
  // Mêmes règles que src/domain/entities/Serveur.ts (et, côté serveur, que
  // Room-Service, qui fait foi) : dupliquées ici parce que ce fichier est un
  // script classique, sans import possible (même raison que creerDmId dans
  // RealGatewayRuntime.js). Ne servent qu'à masquer les actions
  // indisponibles. `role` = `monRole` d'un serveur ('admin', 'proprietaire',
  // 'moderateur', 'membre' ou null).
  const RANG_ROLE = { membre: 1, moderateur: 2, proprietaire: 3, admin: 4 };

  function rangRole(role) {
    return RANG_ROLE[role] ?? 0;
  }

  /** Créer / modifier / supprimer des salons, expulser, voir les invitations. */
  function peutModererServeur(role) {
    return rangRole(role) >= RANG_ROLE.moderateur;
  }

  /** Renommer, rendre public/privé, supprimer le serveur, nommer des modérateurs. */
  function peutGererServeur(role) {
    return rangRole(role) >= RANG_ROLE.proprietaire;
  }

  function initialesServeur(nom) {
    return String(nom ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((mot) => mot.charAt(0).toUpperCase())
      .join('');
  }

  /**
   * Icônes des serveurs dans le rail de gauche (page des salons ET page des
   * messages privés) : une par serveur, insérées juste avant `avant` (le
   * bouton « + »). Remplace les icônes précédemment rendues.
   *
   * @param {object} options
   * @param {HTMLElement} options.conteneur #server-rail
   * @param {HTMLElement|null} options.avant élément avant lequel insérer
   * @param {object[]} options.serveurs résumés { id, nom, icone }
   * @param {string|null} options.serveurActifId
   * @param {Set<string>} options.nonLus serveurs à pastiller
   * @param {(serveur: object) => void} options.surChoix
   */
  // Dernière liste de serveurs affichée dans le rail, pour la redessiner
  // AUSSITÔT au chargement de la page suivante (voir afficherRailDepuisCache)
  // au lieu d'attendre le réseau : sinon les icônes apparaissaient d'un coup
  // et le bouton « + » descendait à chaque changement de page. localStorage
  // (et non sessionStorage) : il survit de façon fiable à la navigation
  // file:// entre pages. Vidé à la déconnexion (oublierRailEnCache), et lié
  // au compte qui l'a écrit : après une session expirée (sans déconnexion
  // volontaire), le compte suivant ne voit jamais les serveurs du précédent.
  const CLEF_RAIL_EN_CACHE = 'chatvardage:rail-serveurs';
  // Vrai dès que le rail a été dessiné depuis le réseau : le cache, lu de
  // façon asynchrone, ne doit plus l'écraser.
  let railReelAffiche = false;

  /** Utilisateur connecté (état du processus main), ou null. */
  async function idUtilisateurConnecte() {
    try {
      const moi = await window.electronAPI?.obtenirUtilisateurConnecte?.();
      return moi?.id ?? null;
    } catch {
      return null;
    }
  }

  async function memoriserRail(serveurs) {
    const utilisateurId = await idUtilisateurConnecte();
    if (!utilisateurId) return;
    try {
      localStorage.setItem(
        CLEF_RAIL_EN_CACHE,
        JSON.stringify({
          utilisateurId,
          serveurs: (serveurs ?? []).map(({ id, nom, icone }) => ({
            id,
            nom,
            icone,
          })),
        })
      );
    } catch {
      // Stockage plein ou indisponible : le rail attendra simplement le réseau.
    }
  }

  async function afficherRailDepuisCache(options) {
    let cache = null;
    try {
      cache = JSON.parse(localStorage.getItem(CLEF_RAIL_EN_CACHE) ?? 'null');
    } catch {
      cache = null;
    }
    // Ancien format (tableau seul, sans compte) : ignoré, remplacé au
    // prochain affichage depuis le réseau.
    if (!cache || !Array.isArray(cache.serveurs)) return;
    const utilisateurId = await idUtilisateurConnecte();
    if (railReelAffiche) return;
    if (!utilisateurId || cache.utilisateurId !== utilisateurId) {
      oublierRailEnCache();
      return;
    }
    afficherRailServeurs({
      ...options,
      serveurs: cache.serveurs,
      memoriser: false,
    });
  }

  function oublierRailEnCache() {
    try {
      localStorage.removeItem(CLEF_RAIL_EN_CACHE);
    } catch {
      // Rien à oublier.
    }
  }

  function afficherRailServeurs({
    conteneur,
    avant,
    serveurs,
    serveurActifId,
    nonLus,
    surChoix,
    memoriser = true,
  }) {
    if (!conteneur) return;
    if (memoriser) {
      railReelAffiche = true;
      void memoriserRail(serveurs);
    }
    conteneur
      .querySelectorAll('.server-icon[data-serveur-id]')
      .forEach((icone) => icone.remove());
    for (const serveur of serveurs ?? []) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'server-icon';
      bouton.classList.toggle('active', serveur.id === serveurActifId);
      bouton.dataset.serveurId = serveur.id;
      bouton.title = serveur.nom;
      bouton.setAttribute('aria-label', serveur.nom);
      if (serveur.icone) {
        const image = document.createElement('img');
        image.className = 'server-icon-image';
        image.alt = '';
        image.src = serveur.icone;
        bouton.appendChild(image);
      } else {
        bouton.appendChild(document.createTextNode(initialesServeur(serveur.nom)));
      }
      const pastille = document.createElement('span');
      pastille.className = 'notif-dot notif-dot--rail';
      pastille.hidden = !nonLus?.has(serveur.id);
      bouton.appendChild(pastille);
      bouton.addEventListener('click', () => surChoix(serveur));
      conteneur.insertBefore(bouton, avant ?? null);
    }
  }

  const etatsActionsMessage = new Map();

  function lireEtatAction(messageId) {
    return etatsActionsMessage.get(messageId) ?? { mode: 'normal' };
  }

  function definirEtatAction(messageId, etat) {
    if (!etat || etat.mode === 'normal') {
      etatsActionsMessage.delete(messageId);
      return;
    }
    etatsActionsMessage.set(messageId, etat);
  }

  function oublierEtatActionMessage(messageId) {
    if (messageId) etatsActionsMessage.delete(messageId);
  }

  function creerActionsMessage({
    message,
    texteEl,
    api,
    utilisateurId,
    t,
    notifier,
    messageErreur,
    champMessage,
    getEtatReseau,
    // Faux pour le message d'un autre qu'un modérateur peut seulement
    // supprimer (Message-Service réserve la modification à l'auteur).
    peutModifier = true,
  }) {
    const actions = document.createElement('div');
    actions.classList.add('message-actions');

    const reseauConnecte = () => getEtatReseau?.()?.statut === 'connecte';

    const modifier = document.createElement('button');
    modifier.type = 'button';
    modifier.classList.add('message-action');
    modifier.textContent = t('messages.edit');
    modifier.title = t('messages.edit');
    modifier.dataset.requiresNetwork = 'true';

    const supprimer = document.createElement('button');
    supprimer.type = 'button';
    supprimer.classList.add('message-action');
    supprimer.textContent = t('messages.delete');
    supprimer.title = t('messages.delete');
    supprimer.dataset.requiresNetwork = 'true';

    const actionsBloquees = !reseauConnecte();
    modifier.disabled = actionsBloquees;
    supprimer.disabled = actionsBloquees;

    const afficherEdition = (brouillon) => {
      const contenuInitial = message.contenu;
      const editeur = document.createElement('div');
      editeur.classList.add('message-edit-row');

      const champ = document.createElement('input');
      champ.type = 'text';
      champ.classList.add('message-edit-input');
      champ.value = brouillon ?? contenuInitial;
      champ.maxLength = 2000;

      const enregistrer = document.createElement('button');
      enregistrer.type = 'button';
      enregistrer.classList.add('message-edit-save');
      enregistrer.textContent = '✓';
      enregistrer.title = t('messages.edit');
      enregistrer.dataset.requiresNetwork = 'true';

      const annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.classList.add('message-edit-cancel');
      annuler.textContent = '✕';
      annuler.title = t('messages.cancel');

      const restaurerEdition = () => {
        definirEtatAction(message.id, { mode: 'normal' });
        editeur.replaceWith(texteEl);
        actions.hidden = false;
      };

      champ.addEventListener('input', () => {
        definirEtatAction(message.id, {
          mode: 'edition',
          brouillon: champ.value,
        });
      });

      const sauvegarder = async () => {
        if (!reseauConnecte()) return;
        const nouveauContenu = champ.value.trim();
        if (!nouveauContenu || nouveauContenu === contenuInitial) {
          restaurerEdition();
          return;
        }

        enregistrer.disabled = true;
        annuler.disabled = true;
        const etatAvantEnvoi = { mode: 'edition', brouillon: champ.value };
        definirEtatAction(message.id, { mode: 'normal' });
        try {
          await api.modifierMessage({
            messageId: message.id,
            utilisateurId: utilisateurId(),
            contenu: nouveauContenu,
          });
          notifier(t('messages.updated'));
        } catch (erreur) {
          definirEtatAction(message.id, etatAvantEnvoi);
          notifier(messageErreur(erreur), true);
          enregistrer.disabled = false;
          annuler.disabled = false;
          champ.focus();
        }
      };

      enregistrer.addEventListener('click', sauvegarder);
      annuler.addEventListener('click', restaurerEdition);
      champ.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void sauvegarder();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          restaurerEdition();
        }
      });

      editeur.append(champ, enregistrer, annuler);
      texteEl.replaceWith(editeur);
      actions.hidden = true;
      return champ;
    };

    const restaurerActions = () => {
      definirEtatAction(message.id, { mode: 'normal' });
      actions.classList.remove('confirming-delete');
      actions.replaceChildren(...boutons);
    };

    const afficherConfirmationSuppression = () => {
      const question = document.createElement('span');
      question.classList.add('message-delete-question');
      question.textContent = t('messages.deleteConfirm');

      const annulerSuppression = document.createElement('button');
      annulerSuppression.type = 'button';
      annulerSuppression.classList.add('message-action');
      annulerSuppression.textContent = t('messages.cancel');

      const confirmerSuppression = document.createElement('button');
      confirmerSuppression.type = 'button';
      confirmerSuppression.classList.add('message-action', 'danger');
      confirmerSuppression.textContent = t('messages.delete');
      confirmerSuppression.dataset.requiresNetwork = 'true';

      annulerSuppression.addEventListener('click', () => {
        restaurerActions();
        supprimer.focus();
      });

      confirmerSuppression.addEventListener('click', async () => {
        if (!reseauConnecte()) return;
        annulerSuppression.disabled = true;
        confirmerSuppression.disabled = true;
        definirEtatAction(message.id, { mode: 'normal' });
        try {
          await api.supprimerMessage({
            messageId: message.id,
            utilisateurId: utilisateurId(),
          });
          notifier(t('messages.deleted'));
          requestAnimationFrame(() => {
            if (champMessage && !champMessage.disabled) {
              champMessage.focus({ preventScroll: true });
            }
          });
        } catch (erreur) {
          definirEtatAction(message.id, { mode: 'suppression' });
          notifier(messageErreur(erreur), true);
          annulerSuppression.disabled = false;
          confirmerSuppression.disabled = false;
        }
      });

      actions.classList.add('confirming-delete');
      actions.replaceChildren(
        question,
        annulerSuppression,
        confirmerSuppression
      );
      return confirmerSuppression;
    };

    modifier.addEventListener('click', () => {
      if (!reseauConnecte()) return;
      definirEtatAction(message.id, {
        mode: 'edition',
        brouillon: message.contenu,
      });
      const champ = afficherEdition(message.contenu);
      champ.focus();
      champ.select();
    });

    supprimer.addEventListener('click', () => {
      if (!reseauConnecte()) return;
      definirEtatAction(message.id, { mode: 'suppression' });
      afficherConfirmationSuppression().focus();
    });

    const boutons = peutModifier ? [modifier, supprimer] : [supprimer];
    actions.append(...boutons);

    const etat = lireEtatAction(message.id);
    if (etat.mode === 'edition' && peutModifier && reseauConnecte()) {
      afficherEdition(etat.brouillon);
    } else if (etat.mode === 'suppression' && reseauConnecte()) {
      afficherConfirmationSuppression();
    }

    return actions;
  }

  let compteurMessageLocal = 0;

  /**
   * Génère un identifiant local pour un message pas encore livré au serveur
   * (préfixé "local-" pour ne jamais entrer en collision avec les
   * identifiants attribués par Message-Service une fois l'envoi
   * réellement accepté).
   */
  function genererIdMessageLocal() {
    compteurMessageLocal += 1;
    return `local-${Date.now()}-${compteurMessageLocal}`;
  }

  /**
   * Crée l'objet représentant un message tapé alors que la connexion au
   * serveur est coupée (ou dont l'envoi a échoué en cours de route) : affiché
   * immédiatement dans la liste comme les autres messages, mais marqué
   * `nonLivre: true` pour que l'appelant lui substitue les actions
   * supprimer/réessayer (voir creerActionsMessageNonLivre) plutôt que les
   * actions modifier/supprimer normales. `envoi` et `date` portent la même
   * valeur : la conversation privée (message-prive.js) trie par `envoi`, le
   * salon (renderer.js) par `date` — dupliquer le champ ici évite à chaque
   * page de connaître le détail de champ de tri de l'autre.
   *
   * @param conversationId Identifiant du salon ou de la conversation privée visé.
   * @param auteurId Identifiant de l'utilisateur courant (auteur du message).
   * @param contenu Contenu texte du message.
   *
   * @returns Un objet "Message"-compatible, avec `nonLivre: true`.
   */
  function creerMessageEnAttente({ conversationId, auteurId, contenu }) {
    const maintenant = Date.now();
    return {
      id: genererIdMessageLocal(),
      conversationId,
      auteurId,
      contenu,
      type: 'texte',
      envoi: maintenant,
      date: maintenant,
      nonLivre: true,
    };
  }

  /**
   * Construit la ligne d'actions d'un message "non livré" (jamais parti vers
   * le serveur, faute de connexion) : un badge indiquant l'échec, plus les
   * boutons réessayer/supprimer. Contrairement à creerActionsMessage, ces
   * actions ne sont JAMAIS désactivées par l'état de connexion — un message
   * en attente doit toujours pouvoir être supprimé, et "réessayer" est
   * justement ce qui re-teste la connexion (c'est à la charge de l'appelant,
   * via `onReessayer`, de vérifier l'état de connexion avant de retenter
   * l'envoi et de laisser le message en attente sinon).
   *
   * @param message Le message en attente (voir creerMessageEnAttente).
   * @param t Fonction de traduction (voir I18n.t).
   * @param enCours Vrai si une tentative d'envoi est déjà en cours pour CE
   *   message (voir reessayerMessageEnAttenteSalon/Dm côté appelant) :
   *   désactive les deux boutons pour la durée de la requête, pour qu'un
   *   double clic sur "Réessayer" ne puisse pas déclencher un second envoi,
   *   et qu'un clic sur "Supprimer" ne puisse pas faire croire à une
   *   annulation d'un envoi déjà parti vers le serveur.
   * @param onReessayer Appelée avec le message quand l'utilisateur clique sur "Réessayer".
   * @param onSupprimer Appelée avec le message quand l'utilisateur clique sur "Supprimer".
   *
   * @returns Un élément DOM à ajouter au corps du message (`.message-body`).
   */
  function creerActionsMessageNonLivre({
    message,
    t,
    enCours = false,
    onReessayer,
    onSupprimer,
  }) {
    const conteneur = document.createElement('div');
    conteneur.classList.add('message-non-livre');

    const badge = document.createElement('span');
    badge.classList.add('message-non-livre-badge');
    badge.textContent = t('messages.notDelivered');

    const actions = document.createElement('div');
    // Pas de classe 'message-non-livre-actions' ici : aucune règle CSS ne la
    // cible (voir styles.css, qui scope volontairement l'opacité via
    // .message-row.non-livre .message-actions pour des raisons de
    // spécificité) — l'ajouter n'avait donc aucun effet, elle était morte.
    actions.classList.add('message-actions');

    const reessayer = document.createElement('button');
    reessayer.type = 'button';
    reessayer.classList.add('message-action');
    reessayer.textContent = t('messages.retry');
    reessayer.title = t('messages.retry');
    reessayer.disabled = enCours;
    reessayer.addEventListener('click', () => onReessayer?.(message));

    const supprimer = document.createElement('button');
    supprimer.type = 'button';
    supprimer.classList.add('message-action', 'danger');
    supprimer.textContent = t('messages.delete');
    supprimer.title = t('messages.delete');
    supprimer.disabled = enCours;
    supprimer.addEventListener('click', () => onSupprimer?.(message));

    actions.append(reessayer, supprimer);
    conteneur.append(badge, actions);
    return conteneur;
  }

  window.ChatUiShared = Object.freeze({
    afficherEtatReseau,
    afficherAvatarCourant,
    remplirAvatar,
    nomAffiche,
    creerSelecteurUtilisateurs,
    chargerEtatReseauEtPresences,
    brancherBoutonReessayer,
    creerActionsMessage,
    oublierEtatActionMessage,
    creerMessageEnAttente,
    creerActionsMessageNonLivre,
    rangRole,
    peutModererServeur,
    peutGererServeur,
    initialesServeur,
    afficherRailServeurs,
    afficherRailDepuisCache,
    oublierRailEnCache,
  });
})();
