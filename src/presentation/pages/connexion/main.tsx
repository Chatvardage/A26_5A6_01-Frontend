import React from 'react';
import ReactDOM from 'react-dom/client';
import './connexion.css';
import { LoginPage } from './LoginPage';
import { creerMockGateway } from '../../../infrastructure/gateways/MockGateway';

// Composition root : c'est le SEUL endroit qui instancie une implémentation
// concrète du gateway (voir la règle documentée dans ChatGateway.ts). Le
// composant LoginPage lui-même ne dépend que du contrat GatewaySession.
const gateway = creerMockGateway();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Élément #root introuvable dans index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <LoginPage gateway={gateway} />
  </React.StrictMode>
);
