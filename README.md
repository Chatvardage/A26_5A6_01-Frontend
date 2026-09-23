# ChatVardage (420-5A6-ST, A26)

Application de clavardage desktop réalisée avec Electron, connectée à
l'infrastructure ChatVardage réelle (Gateway + microservices — voir
`A26_5A6_01-Infra`) : authentification par mot de passe, salons et DM réels,
présence et messages de salon en temps réel via Socket.IO. Voir
`MOCKGATEWAY.md` pour le détail du contrat HTTP/Socket.IO consommé.

## 1. Objectifs

- Authentification par courriel/pseudo + mot de passe, pseudo modifiable
  après l'inscription (unique, 3-20 caractères).
- Salons publics et privés avec invitations, gestion (créer/renommer/changer
  la visibilité/supprimer/retirer un membre) réservée aux modérateurs/admins.
- Messages et conversations privées (DM), et messages de salon.
- Présence en ligne/hors ligne et indicateur « en train d'écrire ».
- Historique paginé (« charger les messages plus anciens »).
- États réseau : connecté, déconnecté et reconnexion (Socket.IO).
- Notifications système lorsqu'un message arrive hors focus.
- Modification et suppression de ses propres messages.
- Page de profil (pseudo, courriel/mot de passe, thème/langue/notifications).
- Application Electron sécurisée et multiplateforme.

## 2. Choix techniques et architecture

- **Langages :** JavaScript + TypeScript.
- **Desktop :** Electron.
- **Connexion :** React + Vite.
- **Chat :** HTML/CSS/JavaScript vanilla.
- **Tests :** Vitest.
- **Qualité :** ESLint + Prettier.
- **Persistance :** jeton de session sur disque (`app.getPath('userData')`),
  backend réel comme source de vérité pour le reste ; stockage local pour
  certaines préférences/états d'interface.

Flux principal :

```text
UI (renderer)
   ↓ API limitée exposée par preload.js
IPC Electron
   ↓
main.js
   ↓
RealGatewayRuntime
   ↓
Gateway ChatVardage (Serveur-API) — HTTP + Socket.IO
```

Le renderer n'a jamais accès directement à Node.js ou à `ipcRenderer`.

## 3. Prérequis

- Node.js 22 recommandé.
- npm.
- Windows, macOS ou Linux.
- L'infrastructure ChatVardage démarrée (voir `A26_5A6_01-Infra`,
  `docker compose up`) — Gateway sur `http://localhost:3000` par défaut. Sans
  elle, l'app se lance normalement mais chaque appel réseau échoue avec
  `ERR_RESEAU_INDISPONIBLE` (connexion/inscription impossibles).

Installation :

```bash
npm install
```

## 4. Lancement

Mode développement (Vite + Electron) :

```bash
npm run dev
```

Backend visé par défaut : `http://localhost:3000` (voir `MOCKGATEWAY.md`
pour le contrat complet). Surchargeable via `CHATVARDAGE_API_URL`/
`CHATVARDAGE_SOCKET_URL`.

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

### Authentification, pseudo et messages

1. Lancer l'application (stack ChatVardage démarrée, voir `A26_5A6_01-Infra`).
2. S'inscrire avec un courriel + mot de passe, puis choisir/confirmer son
   pseudo sur l'écran qui suit (unique, 3-20 caractères, modifiable plus tard
   depuis le profil).
3. Rejoindre un salon public.
4. Envoyer un message et vérifier l'horodatage.
5. Modifier puis supprimer un de ses propres messages.
6. Ouvrir les messages privés et envoyer un DM.
7. Fermer puis relancer l'application : vérifier que la session est reprise
   automatiquement (jeton persisté) sans repasser par l'écran de connexion.

### Salon privé, invitation et gestion (modérateur/admin)

1. Avec un compte modérateur ou admin, créer un salon privé.
2. Inviter un autre utilisateur.
3. Avec le second compte (sur une autre instance de l'app), ouvrir
   **Invitations** puis accepter ou refuser l'invitation.
4. Vérifier que l'accès au salon privé correspond à la réponse.
5. Depuis le compte modérateur/admin, renommer le salon, changer sa
   visibilité, retirer un membre, puis le supprimer — vérifier qu'un compte
   `utilisateur` simple ne voit aucune de ces actions (ni le bouton "Créer
   un salon").

### Présence et typing

1. Vérifier sa propre présence (bouton de présence) et son reflet dans la
   liste des membres/un DM.
2. Commencer à écrire dans un salon ou un DM depuis un second compte.
3. Vérifier que l'indicateur « en train d'écrire » apparaît puis disparaît.

### Réseau

1. Cliquer **Coupure**.
2. Vérifier l'état **Déconnecté**.
3. Vérifier qu'un message ne peut pas être envoyé hors réseau.
4. Cliquer **Reconnexion**.
5. Vérifier la transition **Reconnexion… → Connecté**.
6. Répéter dans un salon et dans un DM.

### Historique / pagination

1. Ouvrir une conversation contenant plusieurs messages.
2. Remonter en haut de la liste ou cliquer **Charger les messages plus anciens**.
3. Vérifier que les anciens messages sont ajoutés sans perdre la position de scroll.

### Notifications

1. Choisir le mode de notification souhaité.
2. Mettre la fenêtre hors focus ou afficher une autre conversation.
3. Recevoir un message d'un second compte et vérifier la notification
   système / l'indicateur non lu.

### Profil

1. Ouvrir la page profil depuis le tableau de bord.
2. Changer son pseudo, vérifier l'unicité (409 si déjà pris).
3. Changer son thème/langue/mode de notification, vérifier la persistance
   après reconnexion.
4. Changer son courriel/mot de passe (mot de passe actuel requis).

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

- La présence des AUTRES utilisateurs n'est pas exposée par le backend (seule
  la sienne l'est, via `/api/config-utilisateur/presence`) : elle s'affiche
  "hors-ligne" par défaut tant qu'un service ne la diffuse pas.
- Aucun répertoire/annuaire global d'utilisateurs n'existe côté backend pour
  un compte non-admin ; la liste de candidats à l'invitation ne montre donc
  que les utilisateurs déjà "connus" (membres de salons visibles,
  participants de DM déjà ouverts, résolus via `GET /api/users/lookup`).
- La signature/code signing des builds n'est pas configurée.
- Les builds macOS/Windows/Linux sont générés par leurs runners respectifs dans GitHub Actions.
