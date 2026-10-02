// Page des salons (index.html) : point d'entrée, chargé EN DERNIER. Tout le
// code de la page vit dans javascript/salons/*.js (voir l'en-tête de
// salons/etat.js pour l'ordre de chargement) ; ce fichier ne fait que la
// démarrer, une fois toutes les définitions et tous les abonnements en
// place.

// Rail affiché tout de suite depuis le cache (serveurs de la dernière page
// visitée), avant le moindre appel réseau : pas de « saut » du rail.
ChatUiShared.afficherRailDepuisCache({
  conteneur: el.rail,
  avant: el.creerRail,
  serveurActifId,
  nonLus: serveursNonLus,
  surChoix: (serveur) => changerServeur(serveur.id),
});
initialiser();
