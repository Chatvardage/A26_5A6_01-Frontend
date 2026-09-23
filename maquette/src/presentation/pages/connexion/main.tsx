import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './connexion.css';
import { LoginPage, type GatewaySession } from './LoginPage';
import { InscriptionPage, type GatewayInscription } from './InscriptionPage';
import { LANGUE_PAR_DEFAUT } from '../../../i18n/i18n-web';
import { genererPseudoParDefaut } from '../../../domain/entities/Utilisateur';

// Composition root : c'est le SEUL endroit qui construit l'implémentation
// des contrats GatewaySession/GatewayInscription (voir la règle documentée
// dans ChatGateway.ts).
//
// Important : ce n'est PAS une instance locale d'un gateway (qui vivrait et
// mourrait avec cette page React) — c'est un adaptateur qui délègue au
// gateway PARTAGÉ du processus main (voir main.js : MockGatewayRuntime ou
// RealGatewayRuntime selon CHATVARDAGE_BACKEND), via window.electronAPI.
// C'est ce qui permet au dashboard, chargé juste après sur une page
// complètement différente, de connaître l'utilisateur qui vient de se
// connecter ici (voir l'incident "connecté en tant qu'alice par défaut" :
// une instance de gateway par renderer perd cette information dès la
// navigation).

/**
 * Electron préfixe systématiquement toute erreur venant d'un handler IPC
 * avec "Error invoking remote method '<canal>': ", peu importe le message
 * qu'on a levé côté main.js. On retire UNIQUEMENT ce préfixe ici — on ne
 * traduit PAS le code restant (ex. "ERR_IDENTIFIANTS_INVALIDES") : la
 * traduction doit se faire au moment du RENDU, dans LoginPage.tsx/
 * InscriptionPage.tsx, avec la langue COURANTE à cet instant. La traduire
 * ici, une fois pour toutes au moment de l'erreur, la fige dans la langue
 * d'alors — un changement de langue après coup n'aurait plus aucun effet sur
 * ce message déjà affiché (bug observé : le message d'erreur restait en
 * anglais après être repassé en français).
 */
function nettoyerPrefixeIpc(err: unknown): string {
  if (!(err instanceof Error)) return '';
  return err.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  );
}

/** Vue actuellement affichée par cette page : connexion ou inscription (voir Login/InscriptionPage). */
type Vue = 'connexion' | 'inscription';

function App() {
  const [vue, setVue] = useState<Vue>('connexion');
  const [langue, setLangue] = useState<string>(LANGUE_PAR_DEFAUT);
  // 'sombre' en dur ici (pas de constante partagée façon LANGUE_PAR_DEFAUT) :
  // seules deux valeurs fixes existent pour le thème, jamais traduites
  // elles-mêmes (voir THEMES_SUPPORTEES dans LoginPage.tsx). Doit rester
  // identique à THEME_PAR_DEFAUT côté main.js.
  const [theme, setTheme] = useState<string>('sombre');

  // Initialise depuis la langue courante côté main (voir main.js), au cas
  // où elle aurait déjà été changée dans cette même session.
  useEffect(() => {
    window.electronAPI
      .obtenirLangue()
      .then((langueResolue) => {
        setLangue(langueResolue);
        document.documentElement.lang = langueResolue;
      })
      .catch(() => {
        // Repli silencieux sur LANGUE_PAR_DEFAUT (valeur initiale).
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

  useEffect(() => {
    window.electronAPI
      .obtenirTheme()
      .then((themeResolu) => {
        setTheme(themeResolu);
        document.documentElement.dataset.theme = themeResolu;
      })
      .catch(() => {
        // Repli silencieux sur la valeur initiale ('sombre').
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
        // Si l'IPC échoue, on ne change rien.
      });
  }, []);

  // Aucune dépendance sur `langue` ici : l'adaptateur ne traduit plus rien
  // lui-même (voir nettoyerPrefixeIpc ci-dessus), donc il n'a pas besoin
  // d'être reconstruit quand la langue change.
  const gatewaySession: GatewaySession = useMemo(
    () => ({
      authentifier: async ({ identifiant, motDePasse }) => {
        try {
          return await window.electronAPI.authentifierSession(
            identifiant,
            motDePasse
          );
        } catch (err) {
          throw new Error(nettoyerPrefixeIpc(err));
        }
      },
    }),
    []
  );

  const gatewayInscription: GatewayInscription = useMemo(
    () => ({
      inscrire: async ({ courriel, motDePasse }) => {
        try {
          // Le pseudo par défaut est dérivé côté renderer (voir
          // genererPseudoParDefaut dans le domaine Utilisateur) et transmis
          // au gateway pour information ; c'est le backend qui garde la
          // main sur l'unicité finale (voir RealGatewayRuntime.inscrire /
          // MockGatewayRuntime.inscrire).
          return await window.electronAPI.inscriptionSession(
            courriel,
            motDePasse,
            genererPseudoParDefaut(courriel)
          );
        } catch (err) {
          throw new Error(nettoyerPrefixeIpc(err));
        }
      },
    }),
    []
  );

  if (vue === 'inscription') {
    return (
      <InscriptionPage
        gateway={gatewayInscription}
        langue={langue}
        changerLangue={changerLangue}
        theme={theme}
        changerTheme={changerTheme}
        allerAConnexion={() => setVue('connexion')}
      />
    );
  }

  return (
    <LoginPage
      gateway={gatewaySession}
      langue={langue}
      changerLangue={changerLangue}
      theme={theme}
      changerTheme={changerTheme}
      allerAInscription={() => setVue('inscription')}
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
