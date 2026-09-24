// salons/temps-reel.js — Temps réel : notifications, nouveaux messages, menu de notifications, indicateur de saisie, événements du processus main.
//
// Page des salons (index.html), découpée en scripts classiques chargés dans
// l'ordre par index.html : etat → historique → affichage → dialogues →
// session → temps-reel → renderer.js (démarrage). Ils partagent la même
// portée globale (const/let/fonctions de haut niveau) : un fichier peut
// utiliser ce qu'un autre définit, à condition que ce ne soit pas pendant
// son propre chargement — seul renderer.js, chargé en dernier, lance quoi
// que ce soit (voir aussi salons.chargement.test.ts, qui vérifie ce contrat).

const btn = document.getElementById('message-prive-btn');

btn?.addEventListener('click', () => {
  window.electronAPI.navigate('message-prive.html');
});

// --- Notifications système -----------------------------------------------
// Remplace l'ancien câblage basé sur des CustomEvent ('channel:selected',
// 'chat:conversation-selected', 'chat:message-received') qui n'étaient
// jamais émis nulle part dans ce fichier (ils visaient une architecture à
// base de ServiceSalon/src/main.js jamais branchée sur la vraie app — voir
// src/domain/service/ServiceSalon.ts, code mort). Résultat concret : la
// conversation "active" côté main.js n'était jamais mise à jour, et le
// garde-fou anti-notification-sur-conversation-déjà-ouverte ne s'activait
// donc jamais. Câblé maintenant directement aux points réels où le salon
// affiché change (afficherMessages()) et où on envoie/simule un message.
const serviceNotifications = window.notifications;

// Pas de service de notifications système (ex. WSL, voir notifierParRepli
// dans main.js) : le message s'affiche dans l'app à la place.
serviceNotifications?.onNotificationRepli?.((message) => {
  notifier(t('notifications.fallbackToast', { texte: message.contenu }));
});

// Tient fenetreEstFocusee à jour (voir sa déclaration plus haut, et la
// requête initiale dans initialiser()) à partir des changements de focus
// réels côté main.js. Quand la fenêtre regagne le focus alors qu'une
// conversation était déjà affichée (donc jamais marquée "lue" pendant
// qu'elle était en arrière-plan, voir afficherMessages()), on relance
// l'affichage pour la marquer "lue" maintenant qu'elle est effectivement
// visible.
if (typeof serviceNotifications?.onFocusChange === 'function') {
  serviceNotifications.onFocusChange((focused) => {
    const regagneLeFocus = focused && !fenetreEstFocusee;
    fenetreEstFocusee = focused;
    if (regagneLeFocus) {
      afficherTout();
      // afficherTout() ne rafraîchit pas lui-même le rond du bouton
      // #message-prive-btn (voir son propre commentaire) : tous les autres
      // appelants de afficherTout()/actualiser() l'appellent juste après
      // pour cette raison (voir actualiser() et le handler de changement de
      // mode de notif plus bas) — celui-ci l'oubliait, laissant ce rond
      // potentiellement périmé jusqu'au prochain actualiser().
      actualiserBadgeMessagesPrives();
    }
  });
}

function definirConversationActivePourNotifs(conversationId) {
  if (typeof serviceNotifications?.setActiveConversation === 'function') {
    serviceNotifications.setActiveConversation(conversationId ?? null);
  }
}

function notifierMessageSysteme(message) {
  if (typeof serviceNotifications?.messageReceived === 'function' && message) {
    serviceNotifications.messageReceived(message);
  }
}

// Clé sessionStorage utilisée pour transmettre, à travers une navigation
// index.html -> message-prive.html, la conversation privée à ouvrir tout de
// suite après le chargement (voir onNavigateToConversation ci-dessous et sa
// consommation dans initialiser()). sessionStorage est partagé entre les
// deux pages (même origine file://), comme `currentUserId` l'est déjà.
const CLEF_CIBLE_DM = 'notif:cible-dm';
// Symétrique de CLEF_CIBLE_DM, mais dans l'autre sens (portée par
// message-prive.js) : présente ici seulement pour la consommer au retour
// vers cette page (voir initialiser()).
const CLEF_CIBLE_SALON = 'notif:cible-salon';

// Clic sur une notification système (voir showMessageNotification dans
// main.js) : ouvre directement la conversation concernée plutôt que de se
// contenter de remettre la fenêtre au premier plan. Si c'est un salon, on
// est déjà sur la bonne page (index.html) ; si c'est une conversation
// privée, on mémorise la cible et on navigue vers message-prive.html, qui
// la consommera à son chargement.
if (typeof serviceNotifications?.onNavigateToConversation === 'function') {
  serviceNotifications.onNavigateToConversation((cible) => {
    const conversationId = cible?.conversationId;
    if (!conversationId) return;
    if (cible.type === 'salon') {
      salonActifId = conversationId;
      afficherTout();
    } else if (cible.type === 'prive') {
      sessionStorage.setItem(CLEF_CIBLE_DM, conversationId);
      window.electronAPI.navigate('message-prive.html');
    }
  });
}

// --- Nouveaux messages en temps réel (salon ou DM) --------------------------
// Remplace l'ancien branchement sur onMockMessage (démo de messages simulés
// par main.js — 'notifications:message-simule' — qui n'existe plus, voir
// RealGatewayRuntime.js : le mock n'avait besoin de simuler des messages
// entrants QUE parce qu'une seule identité pouvait être "active" à la fois ;
// avec de vrais comptes/JWT, le WebSocket du Serveur-API pousse maintenant un
// vrai événement à chaque nouveau message, salon ou DM confondus — voir
// 'messages:nouveau' dans main.js/preload.js). Si la conversation concernée
// est celle actuellement affichée, un actualiser() complet suffit (plus
// simple et plus sûr qu'un ajout incrémental au DOM) ; sinon, on relaie vers
// le même chemin de notification (rond + notification système selon
// NotifPrefs) déjà utilisé par cette page. Corps du handler partagé avec
// message-prive.js via NotifPrefs.traiterMessageSimule (voir
// notif-prefs.js) : seule la partie "quoi rafraîchir à l'écran" diffère
// réellement d'une page à l'autre.
/**
 * Message de salon reçu en temps réel (déjà complet dans `payload`) : ajouté
 * directement à l'état affiché, SANS recharger serveurs, invitations et
 * historique de chaque salon (voir actualiser), ce qui faisait une dizaine
 * de requêtes HTTP par message reçu dans un salon actif.
 * - salon d'un autre serveur : seule la pastille du rail change ;
 * - auteur dont le nom n'est pas encore connu : rechargement complet, pour
 *   résoudre son pseudo et sa photo.
 */
async function integrerMessageSalonRecu(payload) {
  const salon = etat.salons.find((item) => item.id === payload.salonId);
  if (!salon) {
    afficherSalons();
    mettreAJourBadgeApplication();
    return;
  }
  const { message } = payload;
  // On ne suit le nouveau message (défilement en bas) que s'il est dans le
  // salon affiché ET qu'on est soi-même l'auteur ou déjà en bas de la liste :
  // sinon, quelqu'un qui relit l'historique (ou un message d'un autre salon)
  // le ramenait tout en bas à chaque message reçu.
  const suivre = LogiqueInterface.doitSuivreNouveauMessage({
    dansConversationAffichee: salon.id === salonActifId,
    estAuteur: message.auteurId === utilisateurActuelId,
    presDuBas: LogiqueInterface.estPresDuBas(el.messages),
  });
  const optionsAffichage = suivre ? {} : { garderScroll: true };
  if (
    message.auteurId !== utilisateurActuelId &&
    !utilisateur(message.auteurId)
  ) {
    await actualiser(optionsAffichage);
    return;
  }
  salon.messages = LogiqueInterface.ajouterMessage(
    salon.messages,
    message,
    'date'
  );
  afficherTout(optionsAffichage);
}

/**
 * Message de salon modifié ou supprimé : appliqué sur place (page récente et
 * historique déjà remonté), SANS recharger serveurs, invitations et
 * historique de chaque salon. L'événement ne dit pas dans quel salon : on
 * cherche le message ; introuvable = message privé ou salon d'un autre
 * serveur, rien à redessiner ici.
 */
function salonContenantMessage(messageId) {
  return etat.salons.find(
    (salon) =>
      LogiqueInterface.contientMessage(salon.messages, messageId) ||
      (etatHistoriqueSalon.salonId === salon.id &&
        LogiqueInterface.contientMessage(
          etatHistoriqueSalon.messagesAnciens,
          messageId
        ))
  );
}

function appliquerMessageSalonModifie(message) {
  const salon = message?.id ? salonContenantMessage(message.id) : null;
  if (!salon) return;
  salon.messages = LogiqueInterface.remplacerMessage(salon.messages, message);
  if (etatHistoriqueSalon.salonId === salon.id) {
    etatHistoriqueSalon.messagesAnciens = LogiqueInterface.remplacerMessage(
      etatHistoriqueSalon.messagesAnciens,
      message
    );
  }
  afficherTout({ garderScroll: true });
}

function appliquerMessageSalonSupprime(messageId) {
  const salon = messageId ? salonContenantMessage(messageId) : null;
  if (!salon) return;
  salon.messages = LogiqueInterface.retirerMessage(salon.messages, messageId);
  if (etatHistoriqueSalon.salonId === salon.id) {
    etatHistoriqueSalon.messagesAnciens = LogiqueInterface.retirerMessage(
      etatHistoriqueSalon.messagesAnciens,
      messageId
    );
  }
  afficherTout({ garderScroll: true });
}

if (typeof window.electronAPI?.onNouveauMessage === 'function') {
  window.electronAPI.onNouveauMessage((payload) => {
    if (!payload?.message) return;
    const estSalon = payload.conversationType === 'salon';
    const messageNormalise = {
      type: estSalon ? 'salon' : 'prive',
      auteurId: payload.message.auteurId,
      contenu: payload.message.contenu,
      conversationId: estSalon
        ? payload.salonId
        : payload.message.conversationId,
    };
    // Message d'un salon d'un AUTRE serveur : pastille sur son icône du rail
    // (le rail n'affiche le détail "non lu" que pour le serveur actif).
    if (
      estSalon &&
      payload.serveurId &&
      payload.serveurId !== serveurActifId &&
      payload.message.auteurId !== utilisateurActuelId &&
      NotifPrefs.afficheRonds(utilisateurActuelId)
    ) {
      serveursNonLus.add(payload.serveurId);
      memoriserServeursNonLus();
    }
    NotifPrefs.traiterMessageSimule(messageNormalise, {
      utilisateurId: utilisateurActuelId,
      surSalon: () => integrerMessageSalonRecu(payload),
      surPrive: async () => {
        await actualiserBadgeMessagesPrives();
        mettreAJourBadgeApplication();
      },
      notifierMessageSysteme,
    });
  });
}

// --- Menu de préférences de notification ----------------------------------
const elNotifBtn = document.querySelector('#open-notif-settings');
const elNotifMenu = document.querySelector('#notif-menu');

function fermerMenuNotif() {
  if (!elNotifMenu || elNotifMenu.hidden) return;
  elNotifMenu.hidden = true;
  elNotifBtn?.setAttribute('aria-expanded', 'false');
}

function ouvrirMenuNotif() {
  if (!elNotifMenu) return;
  const modeActuel = NotifPrefs.obtenirMode(utilisateurActuelId);
  elNotifMenu.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
    radio.checked = radio.value === modeActuel;
  });
  const caseApercu = elNotifMenu.querySelector('#notif-apercu');
  if (caseApercu)
    caseApercu.checked = NotifPrefs.afficheApercu(utilisateurActuelId);
  elNotifMenu.hidden = false;
  elNotifBtn?.setAttribute('aria-expanded', 'true');
}

// Contenu des messages dans les notifications système (écran verrouillé).
elNotifMenu
  ?.querySelector('#notif-apercu')
  ?.addEventListener('change', (event) => {
    NotifPrefs.definirApercu(utilisateurActuelId, event.target.checked);
  });

elNotifBtn?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (elNotifMenu?.hidden === false) {
    fermerMenuNotif();
  } else {
    ouvrirMenuNotif();
  }
});

elNotifMenu?.addEventListener('click', (event) => event.stopPropagation());

elNotifMenu?.querySelectorAll('input[name="notif-mode"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    const precedent = NotifPrefs.obtenirMode(utilisateurActuelId);
    NotifPrefs.definirMode(utilisateurActuelId, radio.value);
    fermerMenuNotif();
    afficherTout();
    actualiserBadgeMessagesPrives();
    try {
      await window.electronAPI.modifierPreferences({
        modeNotification: radio.value,
      });
      notifier(t('notifications.preferenceUpdated'));
    } catch (erreur) {
      NotifPrefs.definirMode(utilisateurActuelId, precedent);
      afficherTout();
      actualiserBadgeMessagesPrives();
      notifier(messageErreur(erreur), true);
    }
  });
});

document.addEventListener('click', fermerMenuNotif);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') fermerMenuNotif();
});

// --- Indicateur "en train d'écrire" (salons) ------------------------------
// Contrairement aux DM (une seule autre personne possible), un salon peut
// avoir plusieurs personnes qui écrivent en même temps — d'où la logique de
// jonction de noms ci-dessous (un seul, deux, ou "un + N autres").
let etatsSaisieSalon = [];

const elTypingIndicator = document.getElementById('typing-indicator');
const elIsTypingNom = document.getElementById('is-typing-nom');

async function actualiserIndicateurSaisie() {
  if (!salonActifId) {
    if (elTypingIndicator) elTypingIndicator.hidden = true;
    return;
  }

  try {
    const etats = await window.electronAPI.obtenirEtatsSaisie(salonActifId);
    etatsSaisieSalon = Array.isArray(etats) ? etats : [];

    const autresQuiEcrivent = etatsSaisieSalon.filter(
      (item) =>
        item.utilisateurId !== utilisateurActuelId && item.est_saisie === true
    );

    if (!elTypingIndicator) return;

    if (autresQuiEcrivent.length > 0) {
      const noms = autresQuiEcrivent
        .map(
          (item) =>
            ChatUiShared.nomAffiche(utilisateur(item.utilisateurId)) ||
            t('typing.someone')
        )
        .filter(Boolean);

      if (elIsTypingNom) {
        if (noms.length === 1) {
          elIsTypingNom.textContent = noms[0];
        } else if (noms.length === 2) {
          elIsTypingNom.textContent = `${noms[0]}${t('typing.and')}${noms[1]}`;
        } else {
          elIsTypingNom.textContent = `${noms[0]}${t('typing.andOthers', { count: noms.length - 1 })}`;
        }
      }

      elTypingIndicator.hidden = false;
      elTypingIndicator.style.setProperty('display', 'flex', 'important');
    } else {
      elTypingIndicator.hidden = true;
      elTypingIndicator.style.setProperty('display', 'none', 'important');
    }
  } catch (err) {
    console.error('[actualiserIndicateurSaisie] Erreur:', err);
  }
}

setInterval(async () => {
  await actualiserIndicateurSaisie();
}, 1500);

const timersArretSaisie = {};

el.message.addEventListener('input', async (event) => {
  if (etatReseau.statut !== 'connecte') return;
  const aDuTexte = event.target.value.trim().length > 0;
  const auteurId = utilisateurActuelId;
  const salonId = salonActifId;

  if (!auteurId || !salonId) return;

  // Annule uniquement le timer actif DE CET UTILISATEUR précis
  if (timersArretSaisie[auteurId]) {
    clearTimeout(timersArretSaisie[auteurId]);
    delete timersArretSaisie[auteurId];
  }

  if (aDuTexte) {
    await window.electronAPI.modifierEtatSaisie({
      conversationId: salonId,
      utilisateurId: auteurId,
      est_saisie: true,
    });

    // Programme l'arrêt pour cet utilisateur
    timersArretSaisie[auteurId] = setTimeout(async () => {
      delete timersArretSaisie[auteurId];
      if (etatReseau.statut !== 'connecte') return;
      await window.electronAPI.modifierEtatSaisie({
        conversationId: salonId,
        utilisateurId: auteurId,
        est_saisie: false,
      });
      // Force une mise à jour immédiate si ce salon est toujours affiché
      await actualiserIndicateurSaisie();
    }, 10000);
  } else {
    await window.electronAPI.modifierEtatSaisie({
      conversationId: salonId,
      utilisateurId: auteurId,
      est_saisie: false,
    });
    await actualiserIndicateurSaisie();
  }
});

ChatUiShared.brancherBoutonReessayer({
  api: window.electronAPI,
  element: el.reessayerConnexion,
  getEtatReseau: () => etatReseau,
  notifierErreur: (erreur) => notifier(messageErreur(erreur), true),
});

window.electronAPI.onEtatReseauChange((nouvelEtat) =>
  afficherEtatReseau(nouvelEtat)
);
// Photo ou alias d'un autre utilisateur modifié : on redessine (les
// avatars viennent de obtenirEtatSalons -> utilisateurs).
window.electronAPI.onProfilsPublicsChange?.(async () => {
  await actualiser({ conserverPositionScroll: true });
});
// Changement dans un de mes serveurs, en temps réel (voir Room-Service →
// Message-Service → 'serveur.change'). Plusieurs événements rapprochés
// (ex. salon créé puis renommé) ne provoquent qu'un seul rechargement.
const DELAI_RECHARGEMENT_SERVEURS_MS = 150;
let minuteurRechargementServeurs = null;
window.electronAPI.onServeurChange?.((evenement) => {
  const nom =
    etat.serveurs.find((serveur) => serveur.id === evenement.serveurId)?.nom ??
    '';
  const pourMoi = evenement.cibleId === utilisateurActuelId;
  if (pourMoi && evenement.raison === 'expulse') {
    notifier(t('servers.kickedFrom', { name: nom }), true);
  } else if (pourMoi && evenement.raison === 'invitation') {
    notifier(t('servers.newInvitation'));
  } else if (evenement.raison === 'supprime' && nom) {
    // `nom` vide : on l'a supprimé nous-même, déjà retiré de l'état.
    notifier(t('servers.deletedNotice', { name: nom }));
  }
  window.clearTimeout(minuteurRechargementServeurs);
  minuteurRechargementServeurs = window.setTimeout(
    () => actualiser({ conserverPositionScroll: true }),
    DELAI_RECHARGEMENT_SERVEURS_MS
  );
});
window.electronAPI.onPreferencesChange((nouvelles) => {
  appliquerPreferences(nouvelles);
  afficherEtatReseau();
  afficherTout();
  afficherPresenceCourante();
  actualiserBadgeMessagesPrives();
});
window.electronAPI.onPresenceChange((presence) => {
  presences[presence.utilisateurId] = presence.statut;
  afficherPresenceCourante();

  const presenceMembre = Array.from(
    el.dialogue?.querySelectorAll('.member-presence[data-user-id]') ?? []
  ).find((element) => element.dataset.userId === presence.utilisateurId);
  if (presenceMembre) {
    presenceMembre.dataset.presence = presence.statut;
    presenceMembre.textContent =
      presence.statut === 'en-ligne'
        ? t('network.online')
        : t('network.offline');
  }
});

// Appliqués sur place, sans rechargement complet (voir
// appliquerMessageSalonModifie / appliquerMessageSalonSupprime).
window.electronAPI.onMessageModifieChange((message) => {
  appliquerMessageSalonModifie(message);
});

window.electronAPI.onMessageSupprimeChange((message) => {
  ChatUiShared.oublierEtatActionMessage(message?.messageId);
  appliquerMessageSalonSupprime(message?.messageId);
});
