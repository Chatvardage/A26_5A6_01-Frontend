import React from 'react';
import ReactDOM from 'react-dom/client';
import './connexion.css';
import { LoginPage, type GatewaySession } from './LoginPage';

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
 * qu'on a levé côté main.js (voir MockGatewayRuntime.connexion). On le
 * retire ici, au point de contact avec l'IPC, pour que LoginPage.tsx
 * affiche un message propre sans avoir à connaître ce détail d'Electron.
 */
function nettoyerErreurIpc(err: unknown): Error {
  if (err instanceof Error) {
    const nettoye = err.message.replace(
      /^Error invoking remote method '[^']+': (?:Error: )?/,
      ''
    );
    return new Error(nettoye);
  }
  return new Error('Erreur inconnue.');
}

const gateway: GatewaySession = {
  pseudoDisponible: (pseudo) => window.electronAPI.pseudoDisponible(pseudo),
  connexion: async (utilisateur) => {
    try {
      return await window.electronAPI.connexionSession({
        id: utilisateur.id,
        pseudo: utilisateur.pseudo,
      });
    } catch (err) {
      throw nettoyerErreurIpc(err);
    }
  },
};

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Élément #root introuvable dans index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <LoginPage gateway={gateway} />
  </React.StrictMode>
);
