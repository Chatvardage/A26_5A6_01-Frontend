# ChatVardage — Contrôle 1 (420-5A6-ST, A26)

Application de clavardage desktop locale réalisée avec Electron. Cette itération n'utilise pas encore de serveur réel : `MockGatewayRuntime` simule les salons, les DM, la présence, le typing, les événements temps réel, la latence et les états réseau. L'architecture UI / IPC / gateway permet de remplacer le mock par un backend HTTP/WebSocket lors d'une itération future.

## 1. Objectifs

- Authentification locale par pseudo unique.
- Salons publics et privés avec invitations simulées.
- Messages et conversations privées (DM).
- Présence en ligne/hors ligne et indicateur « en train d'écrire ».
- Historique paginé (« charger les messages plus anciens »).
- États réseau simulés : connecté, déconnecté et reconnexion.
- Notifications système lorsqu'un message arrive hors focus.
- Modification et suppression de ses propres messages.
- Application Electron sécurisée et multiplateforme.

## 2. Choix techniques et architecture

- **Langages :** JavaScript + TypeScript.
- **Desktop :** Electron.
- **Connexion :** React + Vite.
- **Chat :** HTML/CSS/JavaScript vanilla.
- **Tests :** Vitest.
- **Qualité :** ESLint + Prettier.
- **Persistance :** données simulées en mémoire et stockage local pour les préférences/états d'interface.

Flux principal :

```text
UI (renderer)
   ↓ API limitée exposée par preload.js
IPC Electron
   ↓
main.js
   ↓
MockGatewayRuntime
   ↓
Domaine / données simulées
```

Le renderer n'a jamais accès directement à Node.js ou à `ipcRenderer`.

## 3. Prérequis

- Node.js 22 recommandé.
- npm.
- Windows, macOS ou Linux.

Installation :

```bash
npm install
```

## 4. Lancement

Mode développement (Vite + Electron) :

```bash
npm run dev
```

Lancement normal :

```bash
npm start
```

Le script `prestart` construit automatiquement la page de connexion avant le lancement normal.

## 5. Qualité et tests

```bash
npm run format
npm run lint
npm test
npm run test:coverage
```

Le warning éventuel de `@typescript-eslint` concernant la version de TypeScript est un avertissement de compatibilité de l'outil et non une erreur ESLint.

## 6. Builds de production

Chaque build commence par compiler la page de connexion avec Vite. Les artifacts Electron sont générés dans `release/`.

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Un build macOS doit être produit sur macOS. Le workflow `.github/workflows/builds.yml` exécute automatiquement les builds sur les bons runners Windows, macOS et Linux lors d'un tag `v*` ou manuellement avec **Run workflow**.

Artifacts attendus :

- Windows : installateur NSIS.
- macOS : DMG.
- Linux : AppImage.

## 7. Scénarios de test pour la démonstration

### Authentification et messages

1. Lancer l'application.
2. Entrer un pseudo local valide et unique.
3. Rejoindre un salon public.
4. Envoyer un message et vérifier l'horodatage.
5. Modifier puis supprimer un de ses propres messages.
6. Ouvrir les messages privés et envoyer un DM.

### Salon privé et invitation

1. Créer un salon privé.
2. Inviter un utilisateur.
3. Changer d'utilisateur simulé.
4. Ouvrir **Invitations** puis accepter ou refuser l'invitation.
5. Vérifier que l'accès au salon privé correspond à la réponse.

### Présence et typing

1. Vérifier la présence dans la liste des membres et dans un DM.
2. Changer la présence en ligne/hors ligne pendant l'exécution.
3. Commencer à écrire dans un salon ou un DM.
4. Vérifier que l'indicateur « en train d'écrire » apparaît puis disparaît.

### Réseau

1. Cliquer **Coupure**.
2. Vérifier l'état **Déconnecté** et la présence hors ligne de l'utilisateur courant.
3. Vérifier qu'un message ne peut pas être envoyé hors réseau.
4. Cliquer **Reconnexion**.
5. Vérifier la transition **Reconnexion… → Connecté** et le retour de la présence en ligne.
6. Répéter dans un salon et dans un DM.

### Historique / pagination

1. Ouvrir une conversation contenant plusieurs messages.
2. Remonter en haut de la liste ou cliquer **Charger les messages plus anciens**.
3. Vérifier que les anciens messages sont ajoutés sans perdre la position de défilement.

### Notifications

1. Choisir le mode de notification souhaité.
2. Mettre la fenêtre hors focus ou afficher une autre conversation.
3. Recevoir un message simulé et vérifier la notification système / l'indicateur non lu.

## 8. Sécurité Electron vérifiée

Dans la `BrowserWindow` :

```text
contextIsolation: true
nodeIntegration: false
```

Autres mesures :

- API limitée via `contextBridge` dans `preload.js`.
- Canaux IPC explicites plutôt qu'un passthrough générique.
- Validation de la provenance des appels IPC dans `main.js`.
- CSP appliquée à la page de connexion.
- Affichage des messages par `textContent` / création DOM, sans injection HTML utilisateur.
- Aucun secret requis ou commité.
- Menu Electron applicatif contrôlé et icône personnalisée.

## 9. Limites connues et pistes d'amélioration

- Le backend est simulé localement; il n'y a pas encore de vraie authentification distante.
- Les identités et autorisations sont adaptées à une maquette locale et devront être validées côté serveur dans la prochaine itération.
- Les événements temps réel utilisent le mock local; ils devront être remplacés par WebSocket/HTTP.
- La signature/code signing des builds n'est pas configurée.
- Les builds macOS/Windows/Linux sont générés par leurs runners respectifs dans GitHub Actions.

## Versionnage et remise

Le projet utilise des branches et des pull requests; aucun push direct ne devrait être fait sur `main` ou `develop`. Avant la remise :

```bash
npm run format
npm run lint
npm test
```

Créer ensuite un tag sémantique (par exemple `v1.0.0`) afin de déclencher les trois builds dans GitHub Actions, puis joindre les artifacts à la remise.

### Checklist finale

- [ ] Démarrage via ce README sans aide.
- [ ] Pseudo → salon → messages temps réel.
- [ ] DM fonctionnels.
- [ ] Présence + typing visibles.
- [ ] États réseau testables : connecté / déconnecté / reconnexion.
- [ ] Historique/pagination fonctionnels.
- [ ] Notifications système testées.
- [ ] `contextIsolation: true` et `nodeIntegration: false` vérifiés.
- [ ] `format`, `lint` et `test` passent.
- [ ] Artifact Windows produit.
- [ ] Artifact macOS produit.
- [ ] Artifact Linux produit.
- [ ] Tag/version cohérents.
