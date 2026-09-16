import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './connexion.css';
import { LoginPage, type GatewaySession } from './LoginPage';
import { LANGUE_PAR_DEFAUT } from '../../../i18n/i18n-web';

// Composition root : c'est le SEUL endroit qui construit l'implémentation
// du contrat GatewaySession (voir la règle documentée dans ChatGateway.ts).
//
// Important : ce n'est PAS une instance locale de MockGateway (qui vivrait
// et mourrait avec cette page React) — c'est un adaptateur qui délègue au
// MockGatewayRuntime PARTAGÉ du processus main (voir main.js), via
// window.electronAPI. C'est ce qui permet au dashboard, chargé juste après
// sur une page complètement différente, de connaître l'utilisateur qui
// vient de se connecter ici (voir l'incident "connecté en tant qu'alice
// par défaut" : une instance de gateway par renderer perd cette
// information dès la navigation).

/**
 * Electron préfixe systématiquement toute erreur venant d'un handler IPC
 * avec "Error invoking remote method '<canal>': ", peu importe le message
 * qu'on a levé côté main.js. On retire UNIQUEMENT ce préfixe ici — on ne
 * traduit PAS le code restant (ex. "ERR_PSEUDO_PRIS|alice") : la traduction
 * doit se faire au moment du RENDU, dans LoginPage.tsx, avec la langue
 * COURANTE à cet instant. La traduire ici, une fois pour toutes au moment
 * de l'erreur, la fige dans la langue d'alors — un changement de langue
 * après coup n'aurait plus aucun effet sur ce message déjà affiché (bug
 * observé : le message d'erreur restait en anglais après être repassé en
 * français).
 */
function nettoyerPrefixeIpc(err: unknown): string {
  if (!(err instanceof Error)) return '';
  return err.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  );
}

function App() {
  const [langue, setLangue] = useState<string>(LANGUE_PAR_DEFAUT);
  // 'sombre' en dur ici (pas de constante partagée façon LANGUE_PAR_DEFAUT) :
  // seules deux valeurs fixes existent pour le thème, jamais traduites
  // elles-mêmes (voir THEMES_SUPPORTEES dans LoginPage.tsx) — un module
  // dédié n'apporterait rien pour un cas aussi simple. Doit rester
  // identique à THEME_PAR_DEFAUT côté main.js.
  const [theme, setTheme] = useState<string>('sombre');

  // Initialise depuis la langue courante côté main (voir main.js), au cas
  // où elle aurait déjà été changée dans cette même session (ex. l'app a
  // été relancée sur le dashboard puis revenue à la connexion — rare, mais
  // pas impossible via la navigation contrôlée).
  useEffect(() => {
    window.electronAPI
      .obtenirLangue()
      .then((langueResolue) => {
        setLangue(langueResolue);
        // renderer.js/message-prive.js (via i18n-browser.js) mettent à jour
        // document.documentElement.lang à chaque changement de langue ; cet
        // écran React doit faire de même pour rester cohérent (lecteurs
        // d'écran, sélection de langue du correcteur orthographique, etc.).
        document.documentElement.lang = langueResolue;
      })
      .catch(() => {
        // Repli silencieux sur LANGUE_PAR_DEFAUT (valeur initiale) si le
        // canal échoue pour une raison quelconque.
      });
  }, []);

  const changerLangue = useCallback((nouvelleLangue: string) => {
    window.electronAPI
      .definirLangue(nouvelleLangue)
      .then((langueConfirmee) => {
        setLangue(langueConfirmee);
        document.documentElement.lang = langueConfirmee;
      })
      .catch(() => {
        // Si l'IPC échoue, on ne change rien : mieux vaut rester dans la
        // langue actuelle (cohérente) qu'afficher un mélange des deux.
      });
  }, []);

  // Même logique que pour la langue ci-dessus : au démarrage, on récupère le
  // thème courant côté main (voir main.js), puis on l'applique sur <html>.
  // C'est LoginPage.tsx qui pose data-theme via son propre effet (voir son
  // commentaire) ; on le fait aussi ici pour couvrir la fraction de seconde
  // avant le premier rendu de LoginPage — même repli que pour `lang` juste
  // au-dessus.
  useEffect(() => {
    window.electronAPI
      .obtenirTheme()
      .then((themeResolu) => {
        setTheme(themeResolu);
        document.documentElement.dataset.theme = themeResolu;
      })
      .catch(() => {
        // Repli silencieux sur la valeur initiale ('sombre') si le canal
        // échoue.
      });
  }, []);

  const changerTheme = useCallback((nouveauTheme: string) => {
    window.electronAPI
      .definirTheme(nouveauTheme)
      .then((themeConfirme) => {
        setTheme(themeConfirme);
        document.documentElement.dataset.theme = themeConfirme;
      })
      .catch(() => {
        // Si l'IPC échoue, on ne change rien : mieux vaut rester dans le
        // thème actuel (cohérent) qu'afficher un mélange des deux.
      });
  }, []);

  // Aucune dépendance sur `langue` ici : l'adaptateur ne traduit plus rien
  // lui-même (voir nettoyerPrefixeIpc ci-dessus), donc il n'a pas besoin
  // d'être reconstruit quand la langue change.
  const gateway: GatewaySession = useMemo(
    () => ({
      pseudoDisponible: (pseudo) => window.electronAPI.pseudoDisponible(pseudo),
      connexion: async (utilisateur) => {
        try {
          return await window.electronAPI.connexionSession({
            id: utilisateur.id,
            pseudo: utilisateur.pseudo,
          });
        } catch (err) {
          throw new Error(nettoyerPrefixeIpc(err));
        }
      },
    }),
    []
  );

  return (
    <LoginPage
      gateway={gateway}
      langue={langue}
      changerLangue={changerLangue}
      theme={theme}
      changerTheme={changerTheme}
    />
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Élément #root introuvable dans index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
