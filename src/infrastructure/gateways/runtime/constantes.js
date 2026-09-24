'use strict';

// runtime/constantes.js — Constantes et utilitaires partagés par les modules
// de RealGatewayRuntime.

/**
 * Identifiant d'une conversation privée : les deux identifiants triés,
 * séparés par « : » (même valeur quel que soit l'expéditeur).
 */
function creerDmId(utilisateurAId, utilisateurBId) {
  return [utilisateurAId, utilisateurBId].sort().join(':');
}

const DELAI_RECONNEXION_INITIAL_MS = 1000;
const DELAI_RECONNEXION_MAX_MS = 15000;
const TAILLE_PAGE_MESSAGES = 15;
// Membres d'un serveur par page (panneau des membres, voir
// obtenirMembresServeur) et par serveur dans les suggestions de DM.
const TAILLE_PAGE_MEMBRES = 50;
const MEMBRES_SUGGERES_PAR_SERVEUR = 20;
const INTERVALLE_POLL_PRESENCE_MS = 20000;
// Limite serveur de GET /api/config-utilisateur/publiques.
const NOMBRE_MAX_IDS_PUBLICS = 100;
// Limite serveur de GET /api/users/lookup (Authentification, LOOKUP_MAX_IDS) :
// au-delà, la requête entière est refusée (400).
const NOMBRE_MAX_IDS_LOOKUP = 100;
// Un « hors ligne » reçu en temps réel (socket fermé, voir Message-Service)
// prime sur le sondage pendant ce délai : User-Config-Service ne constate
// l'absence qu'après ~90 s sans signe de vie (voir `actif`).
const DUREE_PRIORITE_HORS_LIGNE_MS = 100_000;
const INTERVALLE_BATTEMENT_COEUR_MS = 15000;
// Repli si Message-Service n'envoie jamais 'connexion.prete' (version plus
// ancienne, déployée séparément) : passé ce délai après 'connect', le socket
// est considéré comme prêt — l'authentification côté serveur (un appel à
// Auth-Service, 3 s max) est alors forcément terminée.
const DELAI_REPLI_CONNEXION_PRETE_MS = 5000;
// Délai d'accusé de réception de 'room-message.join' (Message-Service
// vérifie l'accès auprès de Room-Service, ROOM_SERVICE_TIMEOUT_MS = 3 s).
const DELAI_ACK_REJOINDRE_SALON_MS = 8000;
// Présence temps réel des seuls utilisateurs connus (voir suivrePresence) :
// 500 au plus (limite de Message-Service), demandes regroupées (le serveur
// en accepte une par seconde).
const MAX_PRESENCES_SUIVIES = 500;
const DELAI_SUIVI_PRESENCE_MS = 1100;
const DELAI_BATTEMENT_COEUR_MS = 5000;
// Cause d'un état non connecté (voir EtatConnexion.ts) : affichée à
// l'utilisateur pour distinguer "ta machine n'a pas de réseau" de "le
// serveur ne répond pas".
const CAUSE_HORS_LIGNE = 'hors-ligne';
const CAUSE_SERVEUR_INJOIGNABLE = 'serveur-injoignable';
const NOM_FICHIER_SESSION = 'session.json';
// Appels qui ne supposent pas de session ouverte : un 401 y veut dire
// « identifiants invalides », jamais « session expirée ».
const CHEMINS_SANS_SESSION = ['/api/auth/login', '/api/auth/register'];

module.exports = {
  DELAI_SUIVI_PRESENCE_MS,
  MAX_PRESENCES_SUIVIES,
  CAUSE_HORS_LIGNE,
  CAUSE_SERVEUR_INJOIGNABLE,
  CHEMINS_SANS_SESSION,
  DELAI_ACK_REJOINDRE_SALON_MS,
  DELAI_BATTEMENT_COEUR_MS,
  DELAI_RECONNEXION_INITIAL_MS,
  DELAI_RECONNEXION_MAX_MS,
  DELAI_REPLI_CONNEXION_PRETE_MS,
  DUREE_PRIORITE_HORS_LIGNE_MS,
  INTERVALLE_BATTEMENT_COEUR_MS,
  INTERVALLE_POLL_PRESENCE_MS,
  MEMBRES_SUGGERES_PAR_SERVEUR,
  NOMBRE_MAX_IDS_LOOKUP,
  NOMBRE_MAX_IDS_PUBLICS,
  NOM_FICHIER_SESSION,
  TAILLE_PAGE_MEMBRES,
  TAILLE_PAGE_MESSAGES,
  creerDmId,
};
