'use strict';

(function (racine) {
  const DELAI_INACTIVITE_MS = 30 * 60 * 1000;
  const EVENEMENTS_INTERACTION = [
    'mousedown',
    'mousemove',
    'keydown',
    'touchstart',
    'click',
    'scroll',
    'wheel',
  ];

  function notifierDeconnexion(message) {
    try {
      if (
        typeof racine.Notification === 'function' &&
        racine.Notification.permission === 'granted'
      ) {
        new racine.Notification('Déconnexion', {
          body: message,
          tag: 'chatvardage-deconnexion-inactivite',
        });
        return;
      }
    } catch {
      // Repli silencieux : l'API notifications n'est pas toujours disponible.
    }

    if (typeof racine.alert === 'function') {
      racine.alert(message);
    }
  }

  function creerMinuteurInactivite({
    delaiMs = DELAI_INACTIVITE_MS,
    estActif = () => true,
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
        notifier('Votre session a été déconnectée pour inactivité.');
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

  async function initialiserPageInactivite() {
    if (!racine.electronAPI || typeof racine.electronAPI.deconnexionSession !== 'function') {
      return null;
    }

    try {
      const utilisateur = await racine.electronAPI.obtenirUtilisateurConnecte?.();
      if (!utilisateur) {
        return null;
      }
    } catch {
      return null;
    }

    const minuteur = creerMinuteurInactivite({
      delaiMs: DELAI_INACTIVITE_MS,
      estActif: () => true,
      notifier: notifierDeconnexion,
      onExpire: async () => {
        try {
          await racine.electronAPI.definirMotifRetourConnexion?.('session-inactive');
        } catch (erreur) {
          console.error('[inactivite] échec de définition du motif :', erreur);
        }
        try {
          await racine.electronAPI.deconnexionSession();
        } catch (erreur) {
          console.error('[inactivite] échec de déconnexion :', erreur);
        }
        try {
          await racine.electronAPI.allerALaConnexion();
        } catch (erreur) {
          console.error('[inactivite] échec de retour à la connexion :', erreur);
        }
      },
    });

    const reactiver = () => minuteur.reinitialiser();
    const ecouteurs = EVENEMENTS_INTERACTION.map((nom) => {
      document.addEventListener(nom, reactiver, { passive: true });
      return { nom, reactiver };
    });

    const stopper = () => {
      ecouteurs.forEach(({ nom }) => {
        document.removeEventListener(nom, reactiver);
      });
      minuteur.arreter();
    };

    minuteur.demarrer();
    racine.Inactivite = Object.freeze({
      DELAI_INACTIVITE_MS,
      creerMinuteurInactivite,
      initialiserPageInactivite,
      stopper,
    });
    return stopper;
  }

  racine.Inactivite = Object.freeze({
    DELAI_INACTIVITE_MS,
    creerMinuteurInactivite,
    initialiserPageInactivite,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initialiserPageInactivite();
    }, { once: true });
  } else {
    void initialiserPageInactivite();
  }
})(globalThis);
