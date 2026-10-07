'use strict';

(function (racine) {
  const DELAI_INACTIVITE_MS = 30 * 60 * 1000;
  const DELAI_THROTTLE_REINITIALISATION_MS = 5000;
  const NOTIFICATION_TITRE_DECONNEXION = 'Déconnexion';
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
        new racine.Notification(NOTIFICATION_TITRE_DECONNEXION, {
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

  const objetInactivite = {
    DELAI_INACTIVITE_MS,
    creerMinuteurInactivite,
    initialiserPageInactivite,
  };

  racine.Inactivite = objetInactivite;

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
        const { definirMotifRetourConnexion, allerALaConnexion, deconnexionSession } =
          racine.electronAPI;

        if (typeof definirMotifRetourConnexion === 'function') {
          try {
            await definirMotifRetourConnexion('session-inactive');
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

    let derniereReinitialisationFrequentMs = 0;
    const reactiver = (evenement) => {
      const estEvenementFrequent =
        evenement.type === 'mousemove' || evenement.type === 'scroll';

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
    };

    minuteur.demarrer();
    racine.Inactivite.stopper = stopper;
    return stopper;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initialiserPageInactivite();
    }, { once: true });
  } else {
    void initialiserPageInactivite();
  }
})(globalThis);
