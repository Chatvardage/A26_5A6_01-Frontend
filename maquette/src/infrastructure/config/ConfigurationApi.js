'use strict';

/**
 * Configuration du backend réel — CommonJS (pas de .ts) : ce fichier est
 * requis directement par main.js, exécuté par Electron sans étape de
 * compilation, même contrainte que MockGatewayRuntime.js (voir son
 * commentaire d'en-tête).
 *
 * URLs FICTIVES pour le moment (voir Architecture.md / MOCKGATEWAY.md) : le
 * backend et sa base de données ne sont pas encore terminés. Une fois
 * disponibles, il suffit de mettre à jour ces valeurs par défaut — ou, sans
 * toucher au code, de définir les variables d'environnement
 * CHATVARDAGE_API_URL / CHATVARDAGE_WS_URL avant de lancer l'app.
 */
const URL_API_HTTP_FICTIVE = 'https://api.chatvardage.exemple/v1';
const URL_API_WS_FICTIVE = 'wss://api.chatvardage.exemple/v1/ws';

/**
 * Quel gateway utiliser côté main :
 * - 'reel'  : RealGatewayRuntime.js (HTTP + WebSocket, voir ci-dessus).
 * - 'mock'  : MockGatewayRuntime.js (données en mémoire, aucun réseau).
 *
 * Par défaut 'reel', pour préparer le branchement au vrai backend dès qu'il
 * existera. Tant que celui-ci n'est pas prêt, chaque appel réseau échouera
 * simplement (voir RealGatewayRuntime.appelHttp) — repasser en mock avec
 * CHATVARDAGE_BACKEND=mock (ex. dans un .env local ou la commande de lancement)
 * si vous développez sans backend disponible.
 */
function obtenirConfiguration() {
  return {
    mode: (process.env.CHATVARDAGE_BACKEND || 'reel').toLowerCase(),
    baseUrlHttp: process.env.CHATVARDAGE_API_URL || URL_API_HTTP_FICTIVE,
    baseUrlWs: process.env.CHATVARDAGE_WS_URL || URL_API_WS_FICTIVE,
  };
}

module.exports = {
  URL_API_HTTP_FICTIVE,
  URL_API_WS_FICTIVE,
  obtenirConfiguration,
};
