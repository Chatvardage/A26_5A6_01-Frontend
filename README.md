# Chatvardage — Client desktop

Application Electron de clavardage connectée aux services HTTP et temps réel de Chatvardage. Connexion, serveurs/salons, DM, profils, thème, langue et notifications passent par une instance de `RealGatewayRuntime`, accessible aux vues par IPC. Aucun mock n’est utilisé à l’exécution.

## Démarrer

1. Suivre le [démarrage complet dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/README.md) puis y lancer `./scripts/healthcheck.sh`.
2. Installer Node.js 22 et npm sur le poste desktop (le backend tourne entièrement dans Docker).
3. Dans ce dépôt :

```bash
npm ci
npm start
```

Développement : `npm run dev`. Le démarrage normal construit la connexion React automatiquement.
Gateway par défaut : `http://localhost:3000`. Variables facultatives : `CHATVARDAGE_API_URL`, `CHATVARDAGE_SOCKET_URL`, `CHATVARDAGE_PROFIL` (session isolée par profil).

Deux comptes en parallèle, dans deux terminaux Bash/WSL :

```bash
npm start
CHATVARDAGE_PROFIL=2 node scripts/start.js
```

PowerShell, deuxième terminal :

```powershell
$env:CHATVARDAGE_PROFIL='2'
node scripts/start.js
```

## Vérifier et construire

```bash
npm audit --audit-level=high
npx tsc --noEmit
npm run lint
npm run test:coverage
npm run build
```

Installateurs : `npm run build:win`, `npm run build:mac`, `npm run build:linux` sur leur OS respectif. Les workflows construisent sur les trois OS lors d’un tag `v*`; le tag doit correspondre à `package.json` et au lockfile.

## Documentation

L’[architecture du frontend](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/architecture-frontend.md), le [guide détaillé](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/services/Frontend.md), le [contrat réseau](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/api/frontend.md) et la [validation fonctionnelle](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/main/docs/validation.md) sont centralisés dans Infra. Voir [AGENTS.md](AGENTS.md) pour contribuer.

Le CI vérifie la cohérence entre la version déclarée, le fichier de verrouillage npm et les tags de publication.


### Suite de la revue PR #100 — position et synchronisation des lectures

Accusés : position complète propagée jusqu’aux coches et « Vu par », fusion monotone des réponses HTTP avec le temps réel, initialisation avant la requête et rejet des réponses d’une ancienne ouverture. Frontière des non-lus figée par identifiant. Marquage réussi : réponse réconciliée, nouveaux messages marqués ensuite seulement si la conversation est encore affichée au premier plan.

Validation locale sous Node 24 : audit high, types (Frontend), lint, tests avec couverture et build. La validation manuelle Electron n’a pas été effectuée. Tests PostgreSQL non exécutés : aucune DATABASE_URL de test disponible et démarrage de la base jetable empêché par les permissions de l’environnement. La validation d’intégration reste requise avant fusion.


### Revue suivante PR #100 — rechargement des non-lus et reconnexion

Une réponse de non-lus dépassée par une autre requête est ignorée. Une réception ou un marquage local pendant le chargement impose une relecture serveur, bornée à une relance; si les deux réponses deviennent périmées, les compteurs locaux sont conservés jusqu’à la synchronisation suivante. Après reconnexion, la conversation active recharge aussi ses accusés de lecture, en conservant sa position monotone pendant la requête.

Validation de cette suite : audit high, types, lint, 277 tests avec couverture 100 % et build passent sous Node 24. Validation manuelle Electron non effectuée.


### Suite de revue du 6 octobre — concurrence et contrat PUT

Les chargements de non-lus préservent les conversations dont le PUT de lecture est en cours. Si un chargement a exclu une conversation, son état est rechargé après la résolution du PUT, avant de rafraîchir les badges ou de retenter une lecture. Régressions couvertes : succès et échec après réception d’un message et abandon de la conversation. Validation : audit high, types, lint, build et 279 tests à couverture 100 % passent sous Node 24. Test manuel Electron non exécuté.

### Suite de revue — compteur autoritaire et libellé de lecture

Après un PUT réussi pour une conversation qui n’est plus affichée, les non-lus sont relus pour distinguer un message arrivé avant ou après la position enregistrée par le serveur. Cela supprime les badges fantômes lorsque la conversation a été quittée et conserve la relance si elle reste affichée. Le contrat expose la position du dernier message lu, pas l’heure de l’action de lecture : l’interface affiche donc « Lu » / « Read » plutôt qu’une heure d’envoi présentée comme heure de lecture.

Validation : audit high, types, lint, build et 280 tests avec couverture 100 % passent sous Node 24. Test manuel Electron non exécuté.
\n\n

### Navigation pendant les attentes

La relance d’un PUT de lecture réévalue le focus et la conversation affichée après la relecture HTTP. Un saut vers un résultat de recherche conserve l’identifiant initial et s’arrête sans notification si la conversation change pendant la pagination, pour les DM comme les salons. Trois régressions simulent ces changements pendant les requêtes. Validation : audit high, types, lint, build et 283 tests avec couverture 100 % passent sous Node 24; validation manuelle Electron non effectuée.

### Recherche pendant une pagination

Les appels de pagination partagent la promesse en cours pour la même conversation : un saut de recherche attend donc le chargement déclenché par le défilement avant de reprendre, au lieu de conclure que le message est absent. L’ouverture d’un résultat DM vérifie aussi la conversation active après le rendu initial. Trois régressions couvrent le partage des requêtes DM/salon et une navigation pendant l’ouverture. Validation manuelle Electron non effectuée.

Validation : audit high, types, lint, build et 286 tests avec couverture 100 % passent sous Node 24.

### Suppression des messages et non-lus

Après chaque événement de suppression, les deux pages relisent les compteurs serveur, même si le message ne figure pas dans leur cache, puis mettent à jour les compteurs, le rail et le badge de l’application. Aucun décrément local : un message supprimé peut déjà être lu ou être absent de la fenêtre d’historique. Deux régressions couvrent les pages salons et DM avec une réponse serveur différée.

Validation : audit high, types, lint, build et 288 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Lecture bornée au dernier message rendu

Le marquage intervient après la construction des messages de la page et transmet l’identifiant du dernier message enregistré rendu, jamais celui d’un brouillon non livré. Le gateway exige cet identifiant et le transmet dans le PUT : un message ajouté côté serveur avant la requête mais pas encore affiché reste non lu. Une lecture en cours mémorise le rendu suivant et ne se relance que si la borne affichée change. Les tests couvrent les bornes DM/salon, les arrivées sans rendu et le rendu suivant pendant un PUT.

Validation : audit high, types, lint, build et 290 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée. Le contrat messageId existe déjà dans Message-Service #9, désormais fusionnée; aucune modification de cette PR fermée.

### Pagination et réouverture

Chaque pagination et saut de recherche conserve l’objet d’historique propre à son ouverture. La réouverture remplace cet objet : les anciennes réponses, erreurs et finalisations sont ignorées, même avec le même identifiant de conversation. Les promesses de pagination ne sont partagées qu’au sein de cette ouverture; une ancienne réponse ne peut ni créer un trou ni arrêter ou libérer la nouvelle requête. Quatre régressions couvrent les DM et salons, la conservation du curseur récent et l’annulation des anciens sauts.

Validation : audit high, types, lint, build et 294 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Événement reçu après un snapshot de non-lus

Un message reçu peut déjà figurer dans les compteurs HTTP : son incrément local est donc provisoire. Après le traitement de chaque événement d’autrui, les deux pages relisent les non-lus serveur puis rafraîchissent les compteurs, le rail et le badge de l’application. Les gardes existantes protègent les réceptions et PUT concurrents; en cas d’échec HTTP, les compteurs locaux sont conservés. Quatre régressions distinguent les événements déjà inclus d’un nouveau message, pour les DM et salons. Les doublures des pages suivent maintenant les compteurs serveur après chaque événement.

Validation : audit high, types, lint, build et 298 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Vérification du tri des lectures et des dates entrantes

La comparaison lexicographique des identifiants à dates égales est conservée : elle reproduit le contrat serveur `(createdAt, id)`, son `orderBy` et ses filtres `id > lastReadMessageId`. Un tri numérique naturel de m2/m10 divergerait de ce contrat; les identifiants ne définissent jamais seuls la chronologie. Le séparateur de non-lus est fixé par identifiant et ne dépend pas de ces comparaisons.

Les événements de lecture vérifient désormais Number.isFinite après Date.parse avant toute résolution de lecteur ou émission vers les pages. Les dates vides, non interprétables et hors plage sont ignorées; les régressions sont ajoutées au test de relais existant. Validation : audit high, types, lint, build et 298 tests avec couverture 100 % passent sous Node 24. Validation manuelle Electron non effectuée.

### Conversation et messagerie : résultats anciens

Un résultat de recherche ouvre une page directement depuis le message choisi, avec un indicateur de chargement puis une mise en évidence instantanée. Les messages intermédiaires ne sont plus chargés. La pagination reprend depuis cette position, vers les messages plus anciens ou plus récents. Une reconstruction locale de Message-Service est nécessaire pour activer les nouveaux paramètres `around` et `direction`.

## Renforcement sécurité — 9 octobre 2026

Une origine distante exige HTTPS hors développement. Les URLs doivent être des origines HTTP(S), sans identifiants, chemin, paramètres ou fragment. Sans configuration Socket séparée, le client utilise l'origine API.

Le jeton persistant requiert le chiffrement `safeStorage`. Le backend Linux `basic_text` est refusé. Sans coffre sécurisé, le client conserve seulement la session en mémoire et supprime l'ancien fichier persistant; une ancienne session en clair est migrée uniquement si un coffre réel est disponible. La recherche paginée partagée annule les requêtes remplacées et déduplique aussi les résultats d'une même page.

### Limites connues

L'audit npm conserve huit alertes modérées issues de `sprintf-js` dans les outils `electron-builder` (`global-agent`/`roarr`). Ne pas appliquer une rétrogradation forcée du packager. Revoir la chaîne au prochain correctif amont. Voir le rapport global dans `../A26_5A6_01-Infra/docs/audit-securite-2026-10-09.md`.
