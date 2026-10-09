// messages-prives/saisie.js — Nouveau message privé, filtres, formulaire d'envoi
// et indicateur de saisie.
//
// Page des messages privés (message-prive.html), découpée en scripts
// classiques chargés dans l'ordre par message-prive.html : etat → historique → conversations → affichage → saisie → rail → message-prive.js
// (démarrage). Ils partagent la même portée globale (const/let/fonctions de
// haut niveau) : un fichier peut utiliser ce qu'un autre définit, à condition
// que ce ne soit pas pendant son propre chargement — seul message-prive.js,
// chargé en dernier, lance quoi que ce soit, au DOMContentLoaded (voir aussi
// message-prive.chargement.test.ts, qui vérifie ce contrat).

// --- Nouveau message privé : suggestions + recherche --------------------
// Sans rien taper : membres de ses salons et interlocuteurs connus
// (obtenirSuggestionsDm). En tapant : recherche par début de pseudo, pour
// écrire à quelqu'un avec qui on ne partage aucun salon. Voir
// ChatUiShared.creerSelecteurUtilisateurs (partagé avec l'invitation dans
// un salon, renderer.js).
async function ouvrirConversationAvec(user) {
  try {
    const conversation = await window.electronAPI.demarrerConversationPrivee({
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
}

/** Autre personne d'une conversation privée, lue au moment du clic (alias,
 * photo et présence à jour). */
function interlocuteur(utilisateurId) {
  return state.conversations.find((c) => c.otherUser?.id === utilisateurId)
    ?.otherUser;
}

/** Fiche de profil de l'autre personne (photo cliquée dans la liste, la
 * barre du haut ou un message) ; « Message privé » ouvre sa conversation,
 * sauf si c'est déjà celle affichée. */
function ouvrirProfilDm(utilisateurId) {
  const autre = interlocuteur(utilisateurId);
  if (!autre) return;
  const active = state.conversations.find(
    (c) => c.id === state.activeConversationId
  );
  ChatUiShared.ouvrirFicheProfil({
    utilisateur: autre,
    enLigne: Boolean(autre.present),
    t,
    utilisateurActuelId: state.currentUserId,
    conversationAvecId: active?.otherUser?.id,
    surMessagePrive: ouvrirConversationAvec,
  });
}

function renderNewDmChoices() {
  if (!dmDialogContent) return;
  dmDialogContent.replaceChildren(
    ...ChatUiShared.creerSelecteurUtilisateurs({
      t,
      messageErreur,
      obtenirSuggestions: () => window.electronAPI.obtenirSuggestionsDm(),
      rechercher: (texte) => window.electronAPI.rechercherUtilisateurs(texte),
      decrireAction: (user) => ({
        libelle: state.conversations.some(
          (conversation) => conversation.otherUser?.id === user.id
        )
          ? t('dm.openExisting')
          : t('dm.newLabel'),
      }),
      surChoix: ouvrirConversationAvec,
      messageAucuneSuggestion: t('dm.noSuggestions'),
    })
  );
}

const timersArretSaisieDm = {};

/** Filtres de la liste des conversations. Appelée une fois, au démarrage (message-prive.js). */
function brancherFiltres() {
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
}

/** Formulaire d'envoi et indicateur de saisie. Appelée une fois, au démarrage (message-prive.js). */
function brancherFormulaireMessage() {
  if (messageForm && messageInput) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const content = messageInput.value.trim();
      if (!content || !state.activeConversationId) {
        return;
      }

      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;
      messageInput.value = '';

      // Hors ligne (etatReseau, JAMAIS `presences` — voir le commentaire sur
      // messagesEnAttenteDm) : le message est affiché tout de suite, marqué
      // "non livré", sans jamais être transmis au gateway. Se mettre
      // soi-même "hors-ligne" via le bouton de présence
      // (page profil) n'a donc aucun effet ici, seule
      // une vraie coupure réseau (qui change etatReseau) en a.
      if (etatReseau.statut !== 'connecte') {
        ajouterMessageEnAttenteDm(
          conversationId,
          ChatUiShared.creerMessageEnAttente({
            conversationId,
            auteurId,
            contenu: content,
          })
        );
        // conserverPositionScroll: true — voir reessayerMessageEnAttenteDm
        // plus haut : sans lui, afficher ce brouillon "non livré" fait
        // sauter la vue en bas de la conversation même si l'utilisateur
        // lisait plus haut dans l'historique.
        await renderActiveConversation({ conserverPositionScroll: true });
        return;
      }

      // 1. Annule le timer d'inactivité de cet utilisateur s'il existe
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      // 2. Réinitialise immédiatement l'état de saisie
      await window.electronAPI.modifierEtatSaisie({
        conversationId,
        utilisateurId: auteurId,
        est_saisie: false,
      });

      // 3. Envoie le message. L'envoi et le rafraîchissement qui suit ont
      // chacun leur propre try/catch (voir reessayerMessageEnAttenteDm plus
      // haut pour le détail du pourquoi) : sans cette séparation, un
      // refreshConversations() en échec APRÈS un envoi pourtant réussi
      // tomberait dans le même bloc catch qu'un envoi raté — le message
      // (déjà bien parti côté serveur) serait alors à tort remis en
      // attente en double, avec une notification d'échec trompeuse.
      let envoye;
      try {
        envoye = await window.electronAPI.envoyerMessagePrive({
          conversationId,
          contenu: content,
          utilisateurId: auteurId,
        });
      } catch (erreur) {
        // Connecté au moment de l'envoi mais échec en cours de route : même
        // traitement qu'un envoi tenté hors ligne, plutôt que de perdre le
        // texte tapé (voir le commentaire plus haut).
        ajouterMessageEnAttenteDm(
          conversationId,
          ChatUiShared.creerMessageEnAttente({
            conversationId,
            auteurId,
            contenu: content,
          })
        );
        // conserverPositionScroll: true — voir reessayerMessageEnAttenteDm
        // plus haut pour le pourquoi.
        await renderActiveConversation({ conserverPositionScroll: true });
        notifier(messageErreur(erreur), true);
        return;
      }
      try {
        // Message renvoyé par le serveur : pas de rechargement complet.
        await integrerMessagePrive(envoye);
      } catch (erreur) {
        // Le message est bien parti ; seul le rechargement de la liste des
        // conversations a échoué ensuite — à ne pas confondre avec un échec
        // d'envoi (pas de brouillon "non livré" ajouté pour un message déjà
        // livré).
        notifier(messageErreur(erreur), true);
        await renderActiveConversation({ conserverPositionScroll: true });
      }
    });

    messageInput.addEventListener('input', async (event) => {
      if (etatReseau.statut !== 'connecte') return;
      const aDuTexte = event.target.value.trim().length > 0;
      const auteurId = state.currentUserId;
      const conversationId = state.activeConversationId;

      if (!auteurId || !conversationId) return;

      // Annule le timer précédent de cet utilisateur
      if (timersArretSaisieDm[auteurId]) {
        clearTimeout(timersArretSaisieDm[auteurId]);
        delete timersArretSaisieDm[auteurId];
      }

      if (aDuTexte) {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: true,
        });

        // Coupe l'état de saisie après 10 secondes sans frappe
        timersArretSaisieDm[auteurId] = setTimeout(async () => {
          delete timersArretSaisieDm[auteurId];
          if (etatReseau.statut !== 'connecte') return;
          await window.electronAPI.modifierEtatSaisie({
            conversationId,
            utilisateurId: auteurId,
            est_saisie: false,
          });
          await actualiserIndicateurSaisie();
        }, 10000);
      } else {
        await window.electronAPI.modifierEtatSaisie({
          conversationId,
          utilisateurId: auteurId,
          est_saisie: false,
        });
        await actualiserIndicateurSaisie();
      }
    });
  }
}
