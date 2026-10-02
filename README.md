# Chatvardage — Client desktop

Application Electron de clavardage issue du contrôle 1, connectée au backend réel pour le contrôle 2. Connexion, serveurs/salons, DM, profils, thème, langue et notifications passent par une instance de `RealGatewayRuntime`, accessible aux vues par IPC. Aucun mock n’est utilisé à l’exécution.

## Démarrer

1. Suivre le [démarrage complet dans Infra](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/README.md) puis y lancer `./scripts/healthcheck.sh`.
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
npx tsc --noEmit
npm run lint
npm run test:coverage
npm run build
```

Installateurs : `npm run build:win`, `npm run build:mac`, `npm run build:linux` sur leur OS respectif. Les workflows construisent sur les trois OS lors d’un tag `v*`; le tag doit correspondre à `package.json` et au lockfile.

## Documentation

L’[architecture du frontend](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/docs/architecture-frontend.md), le [guide détaillé](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/docs/services/Frontend.md), le [contrat réseau](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/docs/api/frontend.md) et la [validation C2](https://github.com/Chatvardage/A26_5A6_01-Infra/blob/develop/docs/validation-c2.md) sont centralisés dans Infra. Voir [AGENTS.md](AGENTS.md) pour contribuer.

Le tag historique C1 `v1.0.1` contient une version déclarée `1.0.0` : cette incohérence est conservée dans l’historique et expliquée dans la remise Infra. Les prochaines versions sont contrôlées par le CI.
