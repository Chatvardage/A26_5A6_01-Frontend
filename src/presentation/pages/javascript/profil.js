'use strict';

// Page profil : vanilla JS chargée comme un <script> classique (même
// contrainte que renderer.js/message-prive.js — nodeIntegration désactivé,
// voir leur en-tête pour le détail complet), utilisant window.electronAPI /
// window.I18n / window.ThemeManager exactement comme ces deux fichiers.
// Pas de notif-prefs.js ici : cette page n'affiche aucun rond/badge de
// notification, elle n'en a pas besoin.

const I18n =
  window.I18n ??
  (() => {
    console.error(
      '[profil] window.I18n est introuvable : i18n-browser.js doit être chargé avant profil.js (voir profil.html). Traductions désactivées pour cette session (clés brutes affichées).'
    );
    return {
      t: (cle) => cle,
      appliquerTraductionsStatiques: () => {},
      messageErreur: (erreur) =>
        erreur instanceof Error ? erreur.message : String(erreur),
      initialiserDepuisElectronAPI: async () => 'fr',
      obtenirLangue: () => 'fr',
      definirLangueActuelle: () => {},
    };
  })();
const t = I18n.t;
const appliquerTraductionsStatiques = I18n.appliquerTraductionsStatiques;
const messageErreur = I18n.messageErreur;

const ThemeManager =
  window.ThemeManager ??
  (() => {
    console.error(
      '[profil] window.ThemeManager est introuvable : theme-browser.js doit être chargé avant profil.js (voir profil.html). Le thème reste bloqué sur sombre pour cette session.'
    );
    return {
      appliquerTheme: () => {},
      obtenirTheme: () => 'sombre',
      initialiserDepuisElectronAPI: async () => 'sombre',
    };
  })();

// Aucun HTML construit sous forme de chaîne dans ce fichier (voir le même
// principe et le même commentaire en tête de renderer.js) : uniquement
// document.createElement/textContent, jamais innerHTML.
function creerEl(tag, options = {}) {
  const { classe, texte, attrs, enfants } = options;
  const element = document.createElement(tag);
  if (classe) element.className = classe;
  if (texte !== undefined) element.textContent = texte;
  if (attrs) {
    for (const [nom, valeur] of Object.entries(attrs)) {
      element.setAttribute(nom, valeur);
    }
  }
  if (enfants) {
    for (const enfant of enfants) {
      if (enfant) element.appendChild(enfant);
    }
  }
  return element;
}

window.addEventListener('DOMContentLoaded', async () => {
  const el = {
    homeBtn: document.getElementById('home-btn'),
    langue: document.getElementById('language-select'),
    pseudoForm: document.getElementById('pseudo-form'),
    pseudoInput: document.getElementById('pseudo-input'),
    pseudoMessage: document.getElementById('pseudo-message'),
    accountForm: document.getElementById('account-form'),
    emailInput: document.getElementById('email-input'),
    newPasswordInput: document.getElementById('new-password-input'),
    currentPasswordInput: document.getElementById('current-password-input'),
    accountMessage: document.getElementById('account-message'),
    preferencesForm: document.getElementById('preferences-form'),
    aliasInput: document.getElementById('alias-input'),
    themeInput: document.getElementById('theme-input'),
    notifModeInput: document.getElementById('notif-mode-input'),
    preferencesMessage: document.getElementById('preferences-message'),
    deletePasswordInput: document.getElementById('delete-password-input'),
    deleteMessage: document.getElementById('delete-message'),
    deleteActions: document.getElementById('delete-account-actions'),
    backToDashboard: document.getElementById('back-to-dashboard'),
    logoutBtn: document.getElementById('logout-btn'),
    toast: document.getElementById('toast'),
  };

  function notifier(message, erreur = false) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.toggle('error', erreur);
    el.toast.classList.add('visible');
    window.setTimeout(() => el.toast.classList.remove('visible'), 2600);
  }

  function afficherMessageChamp(element, texte, genre) {
    if (!element) return;
    element.textContent = texte;
    element.hidden = !texte;
    element.dataset.kind = genre;
  }

  // --- i18n / thème -----------------------------------------------------
  // Même séquence qu'au démarrage de renderer.js/message-prive.js : langue
  // courante d'abord (affecte tout t() appelé ensuite), puis thème (posé sur
  // <html> avant le premier rendu visible).
  if (el.langue) {
    el.langue.value = await I18n.initialiserDepuisElectronAPI(
      window.electronAPI
    );
  } else {
    await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  }
  appliquerTraductionsStatiques();
  await ThemeManager.initialiserDepuisElectronAPI(window.electronAPI);

  el.langue?.addEventListener('change', async (event) => {
    try {
      I18n.definirLangueActuelle(
        await window.electronAPI.definirLangue(event.target.value)
      );
    } catch {
      // Repli silencieux : la langue affichée reste celle d'avant si le
      // canal échoue (même choix que renderer.js/message-prive.js).
    }
    el.langue.value = I18n.obtenirLangue();
    appliquerTraductionsStatiques();
  });

  // --- Chargement des données existantes ---------------------------------
  async function chargerProfil() {
    try {
      const utilisateur = await window.electronAPI.profilObtenir();
      if (el.pseudoInput) el.pseudoInput.value = utilisateur.pseudo ?? '';
      if (el.emailInput) el.emailInput.value = utilisateur.courriel ?? '';
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    }
  }

  async function chargerConfig() {
    try {
      const config = await window.electronAPI.configObtenir();
      if (el.aliasInput) el.aliasInput.value = config.alias ?? '';
      // Ce sélecteur reflète la PRÉFÉRENCE persistée côté serveur
      // (User-Config-Service), pas le thème live de CETTE page (voir
      // ThemeManager ci-dessus, alimenté par le canal IPC 'theme:*' séparé,
      // partagé avec le reste de l'app et réinitialisé à chaque lancement) —
      // les deux notions coexistent volontairement, voir le commentaire de
      // classe équivalent plus haut. Changer ce sélecteur ne re-thème donc
      // pas cette page en direct, seulement la préférence sauvegardée.
      if (el.themeInput) el.themeInput.value = config.theme ?? 'sombre';
      if (el.notifModeInput)
        el.notifModeInput.value = config.modeNotification ?? 'systeme';
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    }
  }

  await Promise.all([chargerProfil(), chargerConfig()]);

  // --- Section Pseudo ------------------------------------------------------
  el.pseudoForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pseudo = el.pseudoInput.value.trim();
    if (!pseudo) return;
    try {
      const utilisateur = await window.electronAPI.profilModifierPseudo(
        pseudo
      );
      el.pseudoInput.value = utilisateur.pseudo;
      afficherMessageChamp(el.pseudoMessage, t('profile.pseudoUpdated'), 'ok');
      notifier(t('profile.pseudoUpdated'));
    } catch (erreur) {
      afficherMessageChamp(el.pseudoMessage, messageErreur(erreur), 'error');
    }
  });

  // --- Section Compte (courriel / mot de passe) -----------------------------
  el.accountForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const courriel = el.emailInput.value.trim();
    const motDePasse = el.newPasswordInput.value;
    const motDePasseActuel = el.currentPasswordInput.value;

    // Les deux champs (courriel, mot de passe) sont optionnels, mais le mot
    // de passe ACTUEL est requis dès que l'un des deux est rempli (règle
    // miroir du backend, voir RealGatewayRuntime.profilModifierCompte) — on
    // vérifie ici pour un message d'erreur immédiat plutôt que d'attendre
    // l'aller-retour réseau, mais le serveur revalide de toute façon.
    if (!courriel && !motDePasse) return;
    if (!motDePasseActuel) {
      afficherMessageChamp(
        el.accountMessage,
        t('profile.currentPasswordRequiredHint'),
        'error'
      );
      return;
    }

    try {
      const donnees = { motDePasseActuel };
      if (courriel) donnees.courriel = courriel;
      if (motDePasse) donnees.motDePasse = motDePasse;
      const utilisateur = await window.electronAPI.profilModifierCompte(
        donnees
      );
      el.emailInput.value = utilisateur.courriel ?? '';
      el.newPasswordInput.value = '';
      el.currentPasswordInput.value = '';
      afficherMessageChamp(
        el.accountMessage,
        t('profile.accountUpdated'),
        'ok'
      );
      notifier(t('profile.accountUpdated'));
    } catch (erreur) {
      afficherMessageChamp(el.accountMessage, messageErreur(erreur), 'error');
    }
  });

  // --- Section Préférences (alias, thème, mode de notification) ------------
  // La présence n'est volontairement pas éditée ici (voir consigne : déjà
  // gérée ailleurs par le bouton de présence du tableau de bord/messages
  // privés — cette page n'est pas la surface de contrôle principale pour
  // ça).
  el.preferencesForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      // alias peut être une chaîne vide/blanche : c'est la façon de
      // l'effacer (voir configModifier dans RealGatewayRuntime.js, qui
      // envoie tel quel tout alias !== undefined) — jamais validé avec
      // validationPseudo, ce n'est pas le pseudo.
      const config = await window.electronAPI.configModifier({
        alias: el.aliasInput.value,
        theme: el.themeInput.value,
        langue: I18n.obtenirLangue(),
        modeNotification: el.notifModeInput.value,
      });
      el.aliasInput.value = config.alias ?? '';
      afficherMessageChamp(
        el.preferencesMessage,
        t('profile.preferencesUpdated'),
        'ok'
      );
      notifier(t('profile.preferencesUpdated'));
    } catch (erreur) {
      afficherMessageChamp(
        el.preferencesMessage,
        messageErreur(erreur),
        'error'
      );
    }
  });

  // --- Section Supprimer le compte -----------------------------------------
  // Confirmation en deux temps (même pattern que le bouton supprimer d'un
  // message, voir creerActionsMessage/afficherConfirmationSuppression dans
  // chat-ui-shared.js, et le panneau "Paramètres du salon" de renderer.js) :
  // pas de confirm() natif du navigateur, jamais utilisé ailleurs dans
  // cette app.
  function afficherBoutonSupprimer() {
    if (!el.deleteActions) return;
    const bouton = creerEl('button', {
      classe: 'secondary-button danger',
      texte: t('profile.deleteButton'),
      attrs: { type: 'button' },
    });
    bouton.addEventListener('click', afficherConfirmationSuppression);
    el.deleteActions.replaceChildren(bouton);
  }

  function afficherConfirmationSuppression() {
    if (!el.deleteActions) return;
    const question = creerEl('span', { texte: t('profile.deleteConfirm') });
    const boutonAnnuler = creerEl('button', {
      classe: 'secondary-button',
      texte: t('messages.cancel'),
      attrs: { type: 'button' },
    });
    const boutonConfirmer = creerEl('button', {
      classe: 'secondary-button danger',
      texte: t('profile.deleteButton'),
      attrs: { type: 'button' },
    });

    boutonAnnuler.addEventListener('click', afficherBoutonSupprimer);
    boutonConfirmer.addEventListener('click', async () => {
      const motDePasseActuel = el.deletePasswordInput.value;
      if (!motDePasseActuel) {
        afficherMessageChamp(
          el.deleteMessage,
          t('profile.currentPasswordRequiredHint'),
          'error'
        );
        return;
      }
      boutonAnnuler.disabled = true;
      boutonConfirmer.disabled = true;
      try {
        await window.electronAPI.profilSupprimerCompte(motDePasseActuel);
        await window.electronAPI.allerALaConnexion();
      } catch (erreur) {
        afficherMessageChamp(el.deleteMessage, messageErreur(erreur), 'error');
        boutonAnnuler.disabled = false;
        boutonConfirmer.disabled = false;
      }
    });

    el.deleteActions.replaceChildren(
      creerEl('div', {
        classe: 'confirm-delete-row',
        enfants: [question, boutonAnnuler, boutonConfirmer],
      })
    );
  }

  afficherBoutonSupprimer();

  // --- Navigation ------------------------------------------------------
  el.backToDashboard?.addEventListener('click', () => {
    window.electronAPI.navigate('index.html');
  });
  el.homeBtn?.addEventListener('click', () => {
    window.electronAPI.navigate('index.html');
  });
  el.logoutBtn?.addEventListener('click', async () => {
    try {
      await window.electronAPI.deconnexionSession();
    } catch (erreur) {
      console.error('[logout] échec de deconnexionSession :', erreur);
    }
    await window.electronAPI.allerALaConnexion();
  });
});
