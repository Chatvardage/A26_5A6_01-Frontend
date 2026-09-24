'use strict';

// Page profil : vanilla JS chargée comme un <script> classique (même
// contrainte que renderer.js/message-prive.js — nodeIntegration désactivé,
// voir leur en-tête pour le détail complet), utilisant window.electronAPI /
// window.I18n / window.ThemeManager exactement comme ces deux fichiers.
// Pas de notif-prefs.js ici : cette page n'affiche aucun rond/badge de
// notification ; le mode de notification y est modifié directement via
// window.electronAPI.modifierPreferences (source de vérité : le serveur).

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
  const $ = (id) => document.getElementById(id);
  const el = {
    homeBtn: $('home-btn'),
    avatar: $('profile-avatar'),
    avatarWrap: document.querySelector('.profile-avatar-wrap'),
    avatarInput: $('avatar-input'),
    avatarRemove: $('avatar-remove'),
    nomAffiche: $('profile-display-name'),
    handle: $('profile-handle'),
    roleBadge: $('profile-role-badge'),
    courrielAffiche: $('profile-email-display'),
    identityForm: $('identity-form'),
    pseudoInput: $('pseudo-input'),
    aliasInput: $('alias-input'),
    identityMessage: $('identity-message'),
    accountForm: $('account-form'),
    emailInput: $('email-input'),
    newPasswordInput: $('new-password-input'),
    currentPasswordField: $('current-password-field'),
    currentPasswordInput: $('current-password-input'),
    accountMessage: $('account-message'),
    deletePasswordInput: $('delete-password-input'),
    deleteMessage: $('delete-message'),
    deleteActions: $('delete-account-actions'),
    backToDashboard: $('back-to-dashboard'),
    logoutBtn: $('logout-btn'),
    logoutAllBtn: $('logout-all-btn'),
    logoutAllMessage: $('logout-all-message'),
    toast: $('toast'),
  };

  // Dernières valeurs enregistrées, pour savoir si un formulaire a des
  // modifications (boutons "Enregistrer" désactivés sinon).
  let utilisateur = null;
  let preferences = null;

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

  /** Désactive le bouton pendant l'appel et affiche "Enregistrement…". */
  async function avecChargement(bouton, action) {
    const libelle = bouton.textContent;
    bouton.disabled = true;
    bouton.dataset.loading = 'true';
    bouton.textContent = t('profile.saving');
    try {
      return await action();
    } finally {
      bouton.dataset.loading = 'false';
      bouton.textContent = libelle;
    }
  }

  // --- i18n / thème -----------------------------------------------------
  // Même séquence qu'au démarrage de renderer.js/message-prive.js : langue
  // courante d'abord (affecte tout t() appelé ensuite), puis thème (posé sur
  // <html> avant le premier rendu visible).
  await I18n.initialiserDepuisElectronAPI(window.electronAPI);
  appliquerTraductionsStatiques();
  await ThemeManager.initialiserDepuisElectronAPI(window.electronAPI);

  // --- En-tête (avatar + identité) --------------------------------------
  function afficherEntete() {
    const pseudo = el.pseudoInput?.value.trim() || utilisateur?.pseudo || '';
    const alias = el.aliasInput?.value.trim() || '';
    const nom = alias || pseudo || '…';
    if (el.nomAffiche) el.nomAffiche.textContent = nom;
    if (el.avatar) {
      if (preferences?.avatar) {
        let image = el.avatar.querySelector('img');
        if (!image) {
          image = creerEl('img', { attrs: { alt: '', draggable: 'false' } });
          el.avatar.replaceChildren(image);
        }
        if (image.getAttribute('src') !== preferences.avatar) {
          image.src = preferences.avatar;
        }
      } else {
        el.avatar.textContent = nom.charAt(0).toUpperCase() || '?';
      }
    }
    if (el.avatarRemove) el.avatarRemove.hidden = !preferences?.avatar;
    if (el.handle) el.handle.textContent = pseudo ? `@${pseudo}` : '';
    if (el.courrielAffiche) el.courrielAffiche.textContent = utilisateur?.courriel ?? '';
    if (el.roleBadge) {
      const role = utilisateur?.role;
      const cle =
        role === 'admin'
          ? 'channels.roleAdmin'
          : role === 'moderateur'
            ? 'channels.roleModerator'
            : null;
      el.roleBadge.hidden = !cle;
      el.roleBadge.textContent = cle ? t(cle) : '';
    }
  }

  // --- Préférences (appliquées + enregistrées au clic) -------------------
  function cocher(nom, valeur) {
    document
      .querySelectorAll(`input[name="${nom}"]`)
      .forEach((radio) => (radio.checked = radio.value === valeur));
  }

  function afficherPreferences(nouvelles) {
    const avatarChange = nouvelles.avatar !== preferences?.avatar;
    preferences = nouvelles;
    if (avatarChange) afficherEntete();
    ThemeManager.appliquerTheme(nouvelles.theme);
    if (nouvelles.langue && nouvelles.langue !== I18n.obtenirLangue()) {
      I18n.definirLangueActuelle(nouvelles.langue);
      appliquerTraductionsStatiques();
      afficherEntete();
      // Boutons construits en JS (sans data-i18n) : à reconstruire.
      afficherBoutonSupprimer();
    }
    cocher('theme', nouvelles.theme);
    cocher('langue', nouvelles.langue);
    cocher('modeNotification', nouvelles.modeNotification);
  }

  for (const nom of ['theme', 'langue', 'modeNotification']) {
    document.querySelectorAll(`input[name="${nom}"]`).forEach((radio) => {
      radio.addEventListener('change', async () => {
        const precedentes = { ...preferences };
        // Effet immédiat (aperçu), puis enregistrement serveur ; en cas
        // d'échec on revient à la valeur précédente.
        afficherPreferences({ ...preferences, [nom]: radio.value });
        try {
          afficherPreferences(
            await window.electronAPI.modifierPreferences({ [nom]: radio.value })
          );
          notifier(t('profile.preferencesUpdated'));
        } catch (erreur) {
          afficherPreferences(precedentes);
          notifier(messageErreur(erreur), true);
        }
      });
    });
  }

  // Changement fait ailleurs (autre page, sélecteur rapide du dashboard) ou
  // réponse du serveur : on se réaligne. L'alias n'est pas écrasé s'il est
  // en cours d'édition.
  window.electronAPI.onPreferencesChange?.((nouvelles) => {
    const aliasModifie = aliasEnCoursDEdition();
    afficherPreferences(nouvelles);
    if (!aliasModifie && el.aliasInput) {
      el.aliasInput.value = nouvelles.alias ?? '';
      majEtatFormulaireIdentite();
    }
  });

  // --- Photo de profil ----------------------------------------------------
  // L'image est recadrée au carré et réduite à 256 px ICI, avant l'envoi :
  // le serveur (User-Config-Service) la stocke telle quelle en data URL et
  // refuse tout ce qui dépasse 90 000 caractères.
  const TAILLE_AVATAR_PX = 256;
  const LONGUEUR_MAX_AVATAR = 88_000; // marge sous la limite serveur
  const TAILLE_MAX_FICHIER = 10 * 1024 * 1024;

  async function redimensionnerAvatar(fichier) {
    // createImageBitmap lit directement le File : ni FileReader ni URL blob:
    // (que la CSP de la page n'autorise pas dans img-src).
    const bitmap = await createImageBitmap(fichier);
    const cote = Math.min(bitmap.width, bitmap.height);
    const canvas = creerEl('canvas', {
      attrs: { width: String(TAILLE_AVATAR_PX), height: String(TAILLE_AVATAR_PX) },
    });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      bitmap,
      (bitmap.width - cote) / 2,
      (bitmap.height - cote) / 2,
      cote,
      cote,
      0,
      0,
      TAILLE_AVATAR_PX,
      TAILLE_AVATAR_PX
    );
    bitmap.close();
    // Qualité décroissante jusqu'à tenir sous la limite (une photo de 256 px
    // en WebP 0.85 fait en général 15-40 Ko, donc un seul essai suffit).
    for (const qualite of [0.85, 0.7, 0.5, 0.35]) {
      const donnees = canvas.toDataURL('image/webp', qualite);
      if (donnees.length <= LONGUEUR_MAX_AVATAR) return donnees;
    }
    throw new Error(t('profile.avatarTooLarge'));
  }

  async function enregistrerAvatar(avatar, messageSucces) {
    if (el.avatarWrap) el.avatarWrap.dataset.loading = 'true';
    try {
      afficherPreferences(await window.electronAPI.modifierPreferences({ avatar }));
      notifier(messageSucces);
    } catch (erreur) {
      notifier(messageErreur(erreur), true);
    } finally {
      if (el.avatarWrap) el.avatarWrap.dataset.loading = 'false';
    }
  }

  el.avatarInput?.addEventListener('change', async () => {
    const fichier = el.avatarInput.files?.[0];
    // Réinitialisé tout de suite : re-choisir le même fichier doit
    // redéclencher 'change'.
    el.avatarInput.value = '';
    if (!fichier) return;
    if (fichier.size > TAILLE_MAX_FICHIER) {
      notifier(t('profile.avatarTooLarge'), true);
      return;
    }
    let avatar;
    try {
      avatar = await redimensionnerAvatar(fichier);
    } catch {
      notifier(t('profile.avatarInvalid'), true);
      return;
    }
    await enregistrerAvatar(avatar, t('profile.avatarUpdated'));
  });

  el.avatarRemove?.addEventListener('click', () =>
    enregistrerAvatar('', t('profile.avatarRemoved'))
  );

  // --- Présence (en ligne / hors ligne) --------------------------------
  // Ne passe pas par les préférences : c'est un endpoint dédié
  // (PUT /api/config-utilisateur/presence, voir modifierPresence), et le
  // changement est poussé à toutes les pages via 'presence:change'.
  document.querySelectorAll('input[name="presence"]').forEach((radio) => {
    radio.addEventListener('change', async () => {
      const precedente = radio.value === 'en-ligne' ? 'hors-ligne' : 'en-ligne';
      try {
        await window.electronAPI.modifierPresence(radio.value);
        notifier(t('profile.preferencesUpdated'));
      } catch (erreur) {
        cocher('presence', precedente);
        notifier(messageErreur(erreur), true);
      }
    });
  });

  window.electronAPI.onPresenceChange?.((presence) => {
    if (presence?.utilisateurId === utilisateur?.id) {
      cocher('presence', presence.statut);
    }
  });

  // --- Section Profil (pseudo + alias) -----------------------------------
  function aliasEnCoursDEdition() {
    return (el.aliasInput?.value.trim() ?? '') !== (preferences?.alias ?? '');
  }

  function majEtatFormulaireIdentite() {
    const bouton = el.identityForm?.querySelector('button[type="submit"]');
    if (!bouton || bouton.dataset.loading === 'true') return;
    const pseudo = el.pseudoInput.value.trim();
    const change = pseudo !== (utilisateur?.pseudo ?? '') || aliasEnCoursDEdition();
    bouton.disabled = !change || !pseudo;
    afficherEntete();
  }

  el.pseudoInput?.addEventListener('input', majEtatFormulaireIdentite);
  el.aliasInput?.addEventListener('input', majEtatFormulaireIdentite);

  el.identityForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const bouton = event.submitter ?? el.identityForm.querySelector('button[type="submit"]');
    const pseudo = el.pseudoInput.value.trim();
    const alias = el.aliasInput.value.trim();
    if (!pseudo) return;
    afficherMessageChamp(el.identityMessage, '', 'ok');
    try {
      await avecChargement(bouton, async () => {
        if (pseudo !== utilisateur?.pseudo) {
          utilisateur = await window.electronAPI.profilModifierPseudo(pseudo);
          el.pseudoInput.value = utilisateur.pseudo;
        }
        if (alias !== (preferences?.alias ?? '')) {
          // Chaîne vide = effacer l'alias (voir configModifier).
          const nouvelles = await window.electronAPI.modifierPreferences({ alias });
          preferences = nouvelles;
          el.aliasInput.value = nouvelles.alias ?? '';
        }
      });
      afficherMessageChamp(el.identityMessage, t('profile.saved'), 'ok');
    } catch (erreur) {
      afficherMessageChamp(el.identityMessage, messageErreur(erreur), 'error');
    }
    majEtatFormulaireIdentite();
  });

  /** Formulaires qui demandent le mot de passe actuel (changement de mot de
   * passe, suppression du compte) : un 401 y signifie que ce mot de passe a
   * été refusé, pas une session expirée. */
  function messageErreurMotDePasse(erreur) {
    return String(erreur?.message ?? '').includes('ERR_HTTP_401')
      ? t('profile.currentPasswordIncorrect')
      : messageErreur(erreur);
  }

  // --- Section Compte (mot de passe ; courriel affiché, non modifiable) -------
  function majEtatFormulaireCompte() {
    const bouton = el.accountForm?.querySelector('button[type="submit"]');
    if (!bouton || bouton.dataset.loading === 'true') return;
    const change = Boolean(el.newPasswordInput.value);
    // Le mot de passe actuel n'est demandé qu'une fois une modification
    // commencée (règle miroir du backend, voir profilModifierCompte).
    if (el.currentPasswordField) el.currentPasswordField.hidden = !change;
    bouton.disabled = !change || !el.currentPasswordInput.value;
  }

  el.newPasswordInput?.addEventListener('input', majEtatFormulaireCompte);
  el.currentPasswordInput?.addEventListener('input', majEtatFormulaireCompte);

  el.accountForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const bouton = event.submitter ?? el.accountForm.querySelector('button[type="submit"]');
    const motDePasse = el.newPasswordInput.value;
    const motDePasseActuel = el.currentPasswordInput.value;
    if (!motDePasse) return;
    if (!motDePasseActuel) {
      afficherMessageChamp(el.accountMessage, t('profile.currentPasswordRequiredHint'), 'error');
      return;
    }
    // Jamais de courriel : il n'est pas modifiable depuis l'app.
    const donnees = { motDePasseActuel, motDePasse };
    try {
      utilisateur = await avecChargement(bouton, () =>
        window.electronAPI.profilModifierCompte(donnees)
      );
      el.emailInput.value = utilisateur.courriel ?? '';
      el.newPasswordInput.value = '';
      el.currentPasswordInput.value = '';
      afficherMessageChamp(el.accountMessage, t('profile.accountUpdated'), 'ok');
      afficherEntete();
    } catch (erreur) {
      afficherMessageChamp(el.accountMessage, messageErreurMotDePasse(erreur), 'error');
    }
    majEtatFormulaireCompte();
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
      classe: 'danger-button',
      texte: t('profile.deleteButton'),
      attrs: { type: 'button' },
    });
    bouton.addEventListener('click', afficherConfirmationSuppression);
    el.deleteActions.replaceChildren(bouton);
  }

  function afficherConfirmationSuppression() {
    if (!el.deleteActions) return;
    const question = creerEl('span', {
      classe: 'confirm-question',
      texte: t('profile.deleteConfirm'),
    });
    const boutonAnnuler = creerEl('button', {
      classe: 'ghost-button',
      texte: t('messages.cancel'),
      attrs: { type: 'button' },
    });
    const boutonConfirmer = creerEl('button', {
      classe: 'danger-button',
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
        el.deletePasswordInput.focus();
        return;
      }
      boutonAnnuler.disabled = true;
      boutonConfirmer.disabled = true;
      try {
        await window.electronAPI.profilSupprimerCompte(motDePasseActuel);
        oublierRailEnCache();
        await window.electronAPI.allerALaConnexion();
      } catch (erreur) {
        afficherMessageChamp(el.deleteMessage, messageErreurMotDePasse(erreur), 'error');
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

  // --- Navigation latérale entre sections --------------------------------
  const boutonsNav = [...document.querySelectorAll('.profile-nav button')];
  for (const bouton of boutonsNav) {
    bouton.addEventListener('click', () => {
      $(bouton.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  if ('IntersectionObserver' in window) {
    const observateur = new IntersectionObserver(
      (entrees) => {
        const visible = entrees.find((entree) => entree.isIntersecting);
        if (!visible) return;
        for (const bouton of boutonsNav) {
          bouton.classList.toggle('active', bouton.dataset.target === visible.target.id);
        }
      },
      { root: $('profile-main'), rootMargin: '0px 0px -65% 0px' }
    );
    boutonsNav.forEach((bouton) => {
      const section = $(bouton.dataset.target);
      if (section) observateur.observe(section);
    });
  }

  // --- Navigation ------------------------------------------------------
  /** Rail des serveurs mémorisé pour l'affichage instantané des pages de
   * chat (même clé que CLEF_RAIL_EN_CACHE dans chat-ui-shared.js, que cette
   * page ne charge pas) : vidé en quittant le compte. */
  function oublierRailEnCache() {
    try {
      localStorage.removeItem('chatvardage:rail-serveurs');
    } catch {
      // Rien à oublier.
    }
  }

  const allerAuTableauDeBord = () => window.electronAPI.navigate('index.html');
  el.backToDashboard?.addEventListener('click', allerAuTableauDeBord);
  el.homeBtn?.addEventListener('click', allerAuTableauDeBord);
  el.logoutBtn?.addEventListener('click', async () => {
    oublierRailEnCache();
    try {
      await window.electronAPI.deconnexionSession();
    } catch (erreur) {
      console.error('[logout] échec de deconnexionSession :', erreur);
    }
    await window.electronAPI.allerALaConnexion();
  });
  el.logoutAllBtn?.addEventListener('click', async () => {
    afficherMessageChamp(el.logoutAllMessage, '', 'ok');
    el.logoutAllBtn.disabled = true;
    try {
      await window.electronAPI.deconnexionPartout();
    } catch (erreur) {
      // Hors ligne ou Auth indisponible : la session reste ouverte ici.
      afficherMessageChamp(el.logoutAllMessage, messageErreur(erreur), 'error');
      el.logoutAllBtn.disabled = false;
      return;
    }
    oublierRailEnCache();
    await window.electronAPI.allerALaConnexion();
  });

  // --- Chargement des données existantes ---------------------------------
  const [resultatProfil, resultatPreferences] = await Promise.allSettled([
    window.electronAPI.profilObtenir(),
    // Relit la config serveur (et non la copie de main.js) : c'est la page
    // où l'utilisateur vérifie ce qui est réellement enregistré.
    window.electronAPI.configObtenir(),
  ]);
  if (resultatProfil.status === 'fulfilled') {
    utilisateur = resultatProfil.value;
    el.pseudoInput.value = utilisateur.pseudo ?? '';
    el.emailInput.value = utilisateur.courriel ?? '';
  } else {
    notifier(messageErreur(resultatProfil.reason), true);
  }
  if (resultatPreferences.status === 'fulfilled') {
    const config = resultatPreferences.value;
    el.aliasInput.value = config.alias ?? '';
    afficherPreferences({
      theme: config.theme,
      langue: config.langue,
      modeNotification: config.modeNotification,
      alias: config.alias ?? null,
      avatar: config.avatar ?? null,
    });
  } else {
    // Repli : la copie locale tenue par main.js.
    afficherPreferences(await window.electronAPI.obtenirPreferences());
    el.aliasInput.value = preferences?.alias ?? '';
    notifier(messageErreur(resultatPreferences.reason), true);
  }
  try {
    const presences = await window.electronAPI.obtenirPresences();
    cocher('presence', presences?.[utilisateur?.id] ?? 'en-ligne');
  } catch {
    // Présence inconnue : aucune option cochée plutôt qu'une fausse valeur.
  }
  afficherEntete();
  majEtatFormulaireIdentite();
  majEtatFormulaireCompte();
  // Données affichées : le contenu apparaît en fondu (voir
  // ThemeManager.pagePrete dans theme-browser.js).
  ThemeManager.pagePrete?.();
});
