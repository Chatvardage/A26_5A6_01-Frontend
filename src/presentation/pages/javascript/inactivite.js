'use strict';

(function (racine) {
  if (racine.Inactivite) return;

  const DELAI_INACTIVITE_MS = 30 * 60 * 1000;
  const DELAI_THROTTLE_REINITIALISATION_MS = 5000;
  const EVENEMENTS_INTERACTION = [
    'mousedown',
    'mousemove',
    'keydown',
    'touchstart',
    'touchmove',
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
      // Dans Electron, la permission de notification est généralement déjà
      // accordée par le runtime / le système d'exploitation, donc on n'ouvre
      // pas de demande explicite ici. Le code est volontairement conservateur :
      // si l'environnement ne la donne pas déjà comme "granted", on ignore la
      // notification système sans produire de dialogue additionnel, ce qui évite
      // un comportement silencieux ambigu dans un contexte web non autorisé.
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

  /**
   * Crée un minuteur d'inactivité.
   *
   * @param {Object} options
   * @param {number} [options.delaiMs=30*60*1000]
   * @param {() => boolean} [options.estActif]
   * @param {(() => string) | string} [options.message]
   * @param {(message: string) => void} [options.notifier]
   * @param {(() => Promise<void> | void)} [options.onExpire]
   * @param {(callback: (...args: any[]) => void, delay?: number, ...args: any[]) => number} [options.setTimeoutFn]
   * @param {(id: number) => void} [options.clearTimeoutFn]
   *
   * Les rejets de `onExpire` doivent être gérés en interne par la fonction
   * fournie ; ce minuteur les capture côté appel pour éviter une
   * `UnhandledPromiseRejection` non explicite.
   */
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

        try {
          const resultat = onExpire();
          if (resultat && typeof resultat.then === 'function') {
            resultat.catch((erreur) => {
              console.error('[inactivite] échec du callback d’expiration :', erreur);
            });
          }
        } catch (erreur) {
          console.error('[inactivite] exception synchronisée dans le callback d’expiration :', erreur);
        }
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
  let initialisationEnCours = false;

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
    if (initialisationEnCours) {
      return null;
    }

    initialisationEnCours = true;
    objetInactivite.stopper();

    try {
      if (!racine.electronAPI || typeof racine.electronAPI.deconnexionSession !== 'function') {
        return null;
      }

      const utilisateur = await racine.electronAPI.obtenirUtilisateurConnecte?.();
      if (!utilisateur) {
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

          if (typeof deconnexionSession === 'function') {
            try {
              await deconnexionSession();
            } catch (erreur) {
              console.error('[inactivite] échec de déconnexion :', erreur);
            }
          } else {
            console.error('[inactivite] méthode absente pour la déconnexion.');
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

      // On démarre à une valeur qui représente « jamais » pour garantir qu'un
      // premier événement fréquent est bien accepté, même si Date.now() vaut 0
      // dans un environnement de test avec fake timers.
      let derniereReinitialisationFrequentMs = Number.NEGATIVE_INFINITY;
      const reactiver = (evenement) => {
        const estEvenementFrequent =
          evenement.type === 'mousemove' ||
          evenement.type === 'keydown' ||
          evenement.type === 'scroll' ||
          evenement.type === 'wheel' ||
          evenement.type === 'touchmove';

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
    } catch (erreur) {
      console.error('[inactivite] échec de l’initialisation :', erreur);
      return null;
    } finally {
      initialisationEnCours = false;
    }
  }

  // L’initialisation de la page est volontairement explicite : le script ne doit
  // pas s’exécuter au chargement pour respecter la convention des scripts vanilla.
})(globalThis);
