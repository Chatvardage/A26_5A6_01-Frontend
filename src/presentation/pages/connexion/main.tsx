import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './connexion.css';
import { LoginPage, type GatewaySession } from './LoginPage';
import { t, LANGUE_PAR_DEFAUT } from '../../../i18n/i18n-web';

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
 * qu'on a levé côté main.js. Le message lui-même est un CODE stable (ex.
 * "ERR_PSEUDO_PRIS|alice", voir MockGatewayRuntime.connexion) plutôt qu'un
 * texte déjà en français : la couche métier ne doit pas connaître la
 * langue choisie par l'utilisateur, donc la traduction se fait ici, à la
 * frontière IPC, dans la langue courante — pour que LoginPage.tsx affiche
 * un message propre et déjà traduit sans avoir à connaître ce détail.
 */
function nettoyerErreurIpc(err: unknown, langue: string): Error {
  if (!(err instanceof Error)) {
    return new Error(t(langue, 'errors.generic'));
  }

  const brut = err.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  );

  const [code, ...params] = brut.split('|');
  const cle = `errors.${code}`;
  const traduit = t(langue, cle);

  if (traduit === cle) {
    // Code non reconnu par le dictionnaire (ex. message déjà en clair,
    // erreur inattendue) : on garde le texte brut plutôt que d'afficher
    // la clé technique à l'utilisateur.
    return new Error(brut);
  }

  return new Error(
    params.length ? traduit.replace('{pseudo}', params[0]) : traduit
  );
}

function App() {
  const [langue, setLangue] = useState<string>(LANGUE_PAR_DEFAUT);

  // Initialise depuis la langue courante côté main (voir main.js), au cas
  // où elle aurait déjà été changée dans cette même session (ex. l'app a
  // été relancée sur le dashboard puis revenue à la connexion — rare, mais
  // pas impossible via la navigation contrôlée).
  useEffect(() => {
    window.electronAPI
      .obtenirLangue()
      .then(setLangue)
      .catch(() => {
        // Repli silencieux sur LANGUE_PAR_DEFAUT (valeur initiale) si le
        // canal échoue pour une raison quelconque.
      });
  }, []);

  const changerLangue = useCallback((nouvelleLangue: string) => {
    window.electronAPI
      .definirLangue(nouvelleLangue)
      .then(setLangue)
      .catch(() => {
        // Si l'IPC échoue, on ne change rien : mieux vaut rester dans la
        // langue actuelle (cohérente) qu'afficher un mélange des deux.
      });
  }, []);

  // Reconstruit l'adaptateur quand la langue change, pour que les erreurs
  // renvoyées par gateway.connexion() soient traduites dans la langue
  // affichée AU MOMENT de l'erreur (pas celle du premier rendu).
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
          throw nettoyerErreurIpc(err, langue);
        }
      },
    }),
    [langue]
  );

  return (
    <LoginPage
      gateway={gateway}
      langue={langue}
      changerLangue={changerLangue}
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
