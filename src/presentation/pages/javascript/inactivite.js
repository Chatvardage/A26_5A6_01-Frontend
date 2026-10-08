'use strict';

(function (racine) {
  const DELAI_INACTIVITE_MS = 30 * 60 * 1000;
  const DELAI_THROTTLE_REINITIALISATION_MS = 5000;
  const EVENEMENTS_INTERACTION = [
    'mousedown',
    'mousemove',
    'keydown',
    'touchstart',
    'click',
    'scroll',
    'wheel',
  ];

  function obtenirTitreNotificationDeconnexion() {
    if (racine.I18n && typeof racine.I18n.t === 'function') {
      return racine.I18n.t('auth.logout') || 'Déconnexion';
    }
    return 'Déconnexion';
  }

  function notifierDeconnexion(message) {
    try {
      if (
        typeof racine.Notification === 'function' &&
        racine.Notification.permission === 'granted'
      ) {
        new racine.Notification(obtenirTitreNotificationDeconnexion(), {
          body: message,
          tag: 'chatvardage-deconnexion-inactivite',
        });
        return;
      }
    } catch (erreur) {
      console.warn('[inactivite] notification de déconnexion impossible :', erreur);
    }

    console.warn('[inactivite] notification de déconnexion non disponible :', message);
  }

  function obtenirMessageDeconnexionInactivite() {
    if (racine.I18n && typeof racine.I18n.t === 'function') {
      return racine.I18n.t('auth.sessionInactive');
    }
    return 'Votre session a été déconnectée pour inactivité.';
  }

  function creerMinuteurInactivite({
    delaiMs = DELAI_INACTIVITE_MS,
    estActif = () => true,
    message = () => 'Votre session a été déconnectée pour inactivité.',
    notifier = notifierDeconnexion,
    onExpire = () => undefined,
    setTimeoutFn = racine.setTimeout.bind(racine),
    clearTimeoutFn = racine.clearTimeout.bind(racine),
  } = {}) {
    let minuteur = null;
    let expire = false;

    function planifier() {
      if (!estActif() || expire) return;
      if (minuteur !== null) {
        clearTimeoutFn(minuteur);
      }
      minuteur = setTimeoutFn(() => {
        expire = true;
        notifier(typeof message === 'function' ? message() : message);
        onExpire();
      }, delaiMs);
    }

    function demarrer() {
      expire = false;
      planifier();
    }

    function arreter() {
      expire = true;
      if (minuteur !== null) {
        clearTimeoutFn(minuteur);
        minuteur = null;
      }
    }

    function reinitialiser() {
      if (!estActif() || expire) return;
      planifier();
    }

    return { demarrer, arreter, reinitialiser };
  }

  let stopperActif = () => undefined;

  const objetInactivite = {
    DELAI_INACTIVITE_MS,
    creerMinuteurInactivite,
    initialiserPageInactivite,
    stopper: () => {
      stopperActif();
    },
  };

  racine.Inactivite = objetInactivite;

  async function initialiserPageInactivite() {
    objetInactivite.stopper();

    if (!racine.electronAPI || typeof racine.electronAPI.deconnexionSession !== 'function') {
      return null;
    }

    try {
      const utilisateur = await racine.electronAPI.obtenirUtilisateurConnecte?.();
      if (!utilisateur) {
        return null;
      }
    } catch (erreur) {
      console.warn('[inactivite] impossible d’obtenir l’utilisateur connecté :', erreur);
      return null;
    }

    const minuteur = creerMinuteurInactivite({
      delaiMs: DELAI_INACTIVITE_MS,
      message: () => obtenirMessageDeconnexionInactivite(),
      notifier: notifierDeconnexion,
      onExpire: async () => {
        const { definirMotifRetourConnexion, allerALaConnexion, deconnexionSession } =
          racine.electronAPI;

        if (typeof definirMotifRetourConnexion === 'function') {
          try {
            const motifRetour = await definirMotifRetourConnexion('session-inactive');
            if (motifRetour !== 'session-inactive') {
              console.warn(
                '[inactivite] motif de retour non confirmé par le main process :',
                motifRetour
              );
            }
          } catch (erreur) {
            console.error('[inactivite] échec de définition du motif :', erreur);
          }
        } else {
          console.error(
            '[inactivite] méthode absente pour définir le motif de retour à la connexion.'
          );
        }

        if (typeof deconnexionSession !== 'function') {
          console.error('[inactivite] méthode absente pour la déconnexion.');
          return;
        }

        try {
          await deconnexionSession();
        } catch (erreur) {
          console.error('[inactivite] échec de déconnexion :', erreur);
        }

        if (typeof allerALaConnexion !== 'function') {
          console.error('[inactivite] méthode absente pour revenir à la connexion.');
          return;
        }

        try {
          await allerALaConnexion();
        } catch (erreur) {
          console.error('[inactivite] échec de retour à la connexion :', erreur);
        }
      },
    });

    let derniereReinitialisationFrequentMs = Number.NEGATIVE_INFINITY;
    const reactiver = (evenement) => {
      const estEvenementFrequent =
        evenement.type === 'mousemove' ||
        evenement.type === 'scroll' ||
        evenement.type === 'wheel';

      if (estEvenementFrequent) {
        const maintenant = Date.now();
        if (maintenant - derniereReinitialisationFrequentMs < DELAI_THROTTLE_REINITIALISATION_MS) {
          return;
        }
        derniereReinitialisationFrequentMs = maintenant;
      }

      minuteur.reinitialiser();
    };
    const ecouteurs = EVENEMENTS_INTERACTION.map((nom) => {
      document.addEventListener(nom, reactiver, { passive: true });
      return { nom, reactiver };
    });

    const stopper = () => {
      ecouteurs.forEach(({ nom }) => {
        document.removeEventListener(nom, reactiver);
      });
      minuteur.arreter();
      if (stopperActif === stopper) {
        stopperActif = () => undefined;
      }
    };

    stopperActif = stopper;
    minuteur.demarrer();
    return stopper;
  }

  // L’initialisation de la page est volontairement explicite : le script ne doit
  // pas s’exécuter au chargement pour respecter la convention des scripts vanilla.
})(globalThis);
