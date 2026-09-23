'use strict';

/**
 * Configuration du backend réel — CommonJS (pas de .ts) : ce fichier est
 * requis directement par main.js, exécuté par Electron sans étape de
 * compilation.
 *
 * Pointe par défaut sur le Gateway (Serveur-API) local de l'infrastructure
 * ChatVardage (voir A26_5A6_01-Infra) : un seul point d'entrée HTTP +
 * Socket.IO, qui relaie vers Authentification/Room-Service/Message-Service/
 * User-Config-Service. Surchargeable sans toucher au code via les variables
 * d'environnement CHATVARDAGE_API_URL / CHATVARDAGE_SOCKET_URL (ex. pour
 * pointer vers un environnement de test ou de démo).
 */
const URL_API_HTTP_PAR_DEFAUT = 'http://localhost:3000';
const URL_SOCKET_PAR_DEFAUT = 'http://localhost:3000';

function obtenirConfiguration() {
  return {
    baseUrlHttp: process.env.CHATVARDAGE_API_URL || URL_API_HTTP_PAR_DEFAUT,
    baseUrlSocket:
      process.env.CHATVARDAGE_SOCKET_URL || URL_SOCKET_PAR_DEFAUT,
  };
}

module.exports = {
  URL_API_HTTP_PAR_DEFAUT,
  URL_SOCKET_PAR_DEFAUT,
  obtenirConfiguration,
};
