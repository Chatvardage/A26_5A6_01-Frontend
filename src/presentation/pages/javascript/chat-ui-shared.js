(function () {
  'use strict';

  function afficherEtatReseau({ etat, elements, t, composerAutorise = true }) {
    if (!etat) return;
    const {
      statutConnexion,
      libelleConnexion,
      messageInput,
      submitButton,
      presenceCourante,
      couperReseau,
      reconnecterReseau,
    } = elements;

    if (statutConnexion) statutConnexion.dataset.state = etat.statut;
    if (libelleConnexion) {
      const libelles = {
        connecte: t('network.connected'),
        deconnecte: t('network.disconnected'),
        reconnexion: t('network.reconnecting'),
      };
      libelleConnexion.textContent = libelles[etat.statut] ?? etat.statut;
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
    if (presenceCourante) presenceCourante.disabled = bloque;
    if (couperReseau) couperReseau.disabled = bloque;
    if (reconnecterReseau)
      reconnecterReseau.disabled = etat.statut !== 'deconnecte';
    document
      .querySelectorAll('[data-requires-network="true"]')
      .forEach((element) => {
        element.disabled = bloque;
      });
  }

  function afficherPresenceCourante({ element, utilisateurId, presences, t }) {
    if (!element || !utilisateurId) return;
    const statut = presences[utilisateurId] ?? 'hors-ligne';
    element.dataset.presence = statut;
    element.textContent =
      statut === 'en-ligne' ? t('network.online') : t('network.offline');
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

  function brancherControlesReseauPresence({
    api,
    elements,
    getEtatReseau,
    getUtilisateurId,
    getPresences,
    notifierErreur,
  }) {
    elements.couperReseau?.addEventListener('click', async () => {
      try {
        await api.simulerCoupureReseau(getUtilisateurId());
      } catch (erreur) {
        notifierErreur(erreur);
      }
    });

    elements.reconnecterReseau?.addEventListener('click', async () => {
      if (getEtatReseau()?.statut !== 'deconnecte') return;
      try {
        await api.simulerReconnexionReseau(900, getUtilisateurId());
      } catch (erreur) {
        notifierErreur(erreur);
      }
    });

    elements.presenceCourante?.addEventListener('click', async () => {
      if (getEtatReseau()?.statut !== 'connecte') return;
      const utilisateurId = getUtilisateurId();
      if (!utilisateurId) return;
      const actuelle = getPresences()[utilisateurId] ?? 'hors-ligne';
      const prochaine = actuelle === 'en-ligne' ? 'hors-ligne' : 'en-ligne';
      try {
        await api.modifierPresence(utilisateurId, prochaine);
      } catch (erreur) {
        notifierErreur(erreur);
      }
    });
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
      actions.replaceChildren(modifier, supprimer);
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

    actions.append(modifier, supprimer);

    const etat = lireEtatAction(message.id);
    if (etat.mode === 'edition' && reseauConnecte()) {
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
   * identifiants "msg-..." générés côté MockGateway une fois l'envoi
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
    afficherPresenceCourante,
    chargerEtatReseauEtPresences,
    brancherControlesReseauPresence,
    creerActionsMessage,
    oublierEtatActionMessage,
    creerMessageEnAttente,
    creerActionsMessageNonLivre,
  });
})();
