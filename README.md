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
