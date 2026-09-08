(function () {
  'use strict';

  function afficherEtatReseau({ etat, elements, t }) {
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

    const bloque = etat.statut !== 'connecte';
    if (messageInput) messageInput.disabled = bloque;
    if (submitButton) submitButton.disabled = bloque;
    if (presenceCourante) presenceCourante.disabled = bloque;
    if (couperReseau) couperReseau.disabled = bloque;
    if (reconnecterReseau)
      reconnecterReseau.disabled = etat.statut !== 'deconnecte';
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

  function creerActionsMessage({
    message,
    texteEl,
    api,
    utilisateurId,
    t,
    notifier,
    messageErreur,
    champMessage,
  }) {
    const actions = document.createElement('div');
    actions.classList.add('message-actions');

    const modifier = document.createElement('button');
    modifier.type = 'button';
    modifier.classList.add('message-action');
    modifier.textContent = t('messages.edit');
    modifier.title = t('messages.edit');

    const supprimer = document.createElement('button');
    supprimer.type = 'button';
    supprimer.classList.add('message-action');
    supprimer.textContent = t('messages.delete');
    supprimer.title = t('messages.delete');

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
      enregistrer.title = t('messages.updated');

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

      annulerSuppression.addEventListener('click', () => {
        restaurerActions();
        supprimer.focus();
      });

      confirmerSuppression.addEventListener('click', async () => {
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
      definirEtatAction(message.id, {
        mode: 'edition',
        brouillon: message.contenu,
      });
      const champ = afficherEdition(message.contenu);
      champ.focus();
      champ.select();
    });

    supprimer.addEventListener('click', () => {
      definirEtatAction(message.id, { mode: 'suppression' });
      afficherConfirmationSuppression().focus();
    });

    actions.append(modifier, supprimer);

    const etat = lireEtatAction(message.id);
    if (etat.mode === 'edition') {
      requestAnimationFrame(() => {
        afficherEdition(etat.brouillon);
      });
    } else if (etat.mode === 'suppression') {
      requestAnimationFrame(() => {
        afficherConfirmationSuppression();
      });
    }

    return actions;
  }

  window.ChatUiShared = Object.freeze({
    afficherEtatReseau,
    afficherPresenceCourante,
    chargerEtatReseauEtPresences,
    brancherControlesReseauPresence,
    creerActionsMessage,
  });
})();
