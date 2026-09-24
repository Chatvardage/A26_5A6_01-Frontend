# AGENTS.md — ChatVardage (frontend / application desktop)

Instructions pour tout agent IA (Claude Code, Cursor, Copilot, etc.) qui
travaille dans **ce dépôt**.

## Portée — lire en premier

Ce dépôt est le **frontend uniquement** : l'application desktop Electron
issue du Contrôle 1. Il n'inclut PAS le backend.

Depuis le Contrôle 2 (backend conteneurisé et services temps réel), le
backend vit dans un **dépôt Git séparé** : API HTTP + WebSocket, base de
données, Redis, panneau d'administration — tout ça hors de ce dépôt, avec
son propre README et son propre docker-compose.yml. Un agent qui travaille
ici n'a pas à implémenter cette API ; ce dépôt ne fait qu'y **consommer**
via `ChatGateway`, une fois cette évolution faite (voir plus bas).

> `Architecture.md` à la racine décrit la structure **réelle** du code
> (processus main, preload, pages, flux de session/préférences/fenêtre).
> Le garder à jour quand on ajoute un fichier, un canal IPC important ou un
> flux.

### Backend réel (Contrôle 2) — état actuel

L'app parle uniquement au vrai backend, via `RealGatewayRuntime.js` (voir
`MOCKGATEWAY.md`). Le mock du Contrôle 1 (`MockGateway.ts`,
`MockGatewayRuntime.js`) et son ancienne copie dans `maquette/src/` ont été
retirés ; ils restent récupérables dans l'historique Git. ⚠️ Une version
précédente de ce document indiquait que l'énoncé exige un mock utilisable
pour les tests et le développement hors ligne : si c'est le cas, c'est à
réintroduire (une implémentation de `ChatGateway` en mémoire, à côté de
`RealGatewayRuntime.js`, pas à sa place). `maquette/` ne contient plus que
les maquettes de design (PDF).

## Ce que c'est (aujourd'hui)

Application de chat desktop (Electron), projet étudiant (cours 420-5A6-ST).
Un seul processus Electron `main.js` fait autorité pour tout l'état
métier (utilisateurs, salons, messages, présence, réseau) : c'est
`RealGatewayRuntime.js`, une seule instance, jamais dupliquée par fenêtre.
Deux surfaces UI très différentes consomment cet état via IPC :

1. **Écran de connexion** (`src/presentation/pages/connexion/`) — React +
   TypeScript, bundlé par Vite. Seule partie de l'app avec un vrai build.
2. **Dashboard + Messages privés** (`src/presentation/pages/index.html` et
   `message-prive.html`) — JS vanilla, chargé directement par Electron
   (`loadFile`), aucun bundler. `nodeIntegration: false` partout : ces
   fichiers n'ont **jamais** accès à `require()` ni à Node.

## Lancer, tester, valider

```bash
npm install
npm run start:dev     # mode dev : Vite + Electron orchestrés par scripts/start.js
npm start              # mode prod : build automatique (prestart) puis Electron seul
npm test               # vitest run
npm run test:coverage  # avec couverture : 100 % exigé sur src/**/*.ts et RealGatewayRuntime.js (voir vitest.config.ts)
npm run lint            # eslint . --ext .js,.jsx,.ts,.tsx
npx tsc --noEmit        # compilation TypeScript sans émission
npm run build           # build de la page de connexion (dist/login/)
```

**Avant de considérer une tâche terminée**, dans cet ordre :
`npx tsc --noEmit` → `npm run lint` → `npm test` (ou `test:coverage` si le
changement touche la logique) → `npm run build`. Un changement qui touche
au dashboard ou aux messages privés (JS vanilla, jamais compilé) ne sera
détecté par **aucun** de ces outils s'il casse au runtime — le seul moyen
fiable de le vérifier est de lancer l'app et de cliquer dedans (voir
"Piège n°1" plus bas).

CI (`.github/workflows/builds.yml`) : `npm ci && npm run lint &&
npm run test:coverage` avant tout build multiplateforme — la couverture
(100 %) est donc vérifiée en CI.

## Architecture réelle (détail complet dans Architecture.md)

```
main.js                    Processus main Electron. Instancie l'UNIQUE
                            RealGatewayRuntime (backend réel), tous les
                            canaux IPC (ipcMain.handle), CSP, menu natif
                            traduit, fenêtre unique
                            (requestSingleInstanceLock), sans cadre hors
                            macOS (frame: false), agrandir/restaurer géré
                            à la main (basculerAgrandissement) et zoom
                            adaptatif (appliquerZoomAdaptatif).
preload.js                  Seul pont autorisé vers le renderer
                            (contextBridge). Deux objets globaux exposés :
                            window.electronAPI (session, salons, i18n,
                            réseau, présence...) et window.notifications
                            (notifications système, badge, focus fenêtre).
                            Injecte aussi la barre de titre (.app-titlebar)
                            dans chaque page, boutons → canaux 'fenetre:*'.
scripts/start.js            Orchestre Vite + Electron (dev) ou juste
                            Electron après build (prod) — évite le rituel
                            manuel "deux terminaux + $env:NODE_ENV".

src/infrastructure/gateways/
  ChatGateway.ts             Interface TypeScript du contrat de gateway
                              (utilisée par l'écran de connexion React).
  RealGatewayRuntime.js        La VRAIE implémentation utilisée par
                              main.js : HTTP + Socket.IO vers le Gateway
                              (Serveur-API). Classe JS simple, aucune
                              dépendance TS. Lève des CODES d'erreur
                              stables (ex. "ERR_PSEUDO_PRIS|alice"), JAMAIS
                              de texte traduit — voir i18n plus bas.
                              (Le mock du Contrôle 1 a été retiré, voir
                              « Backend réel » plus haut.)

src/i18n/
  translations.json           SEULE source de vérité pour tous les textes
                               (clés imbriquées, fr + en).
  i18n.js                      Lookup t() en CommonJS, pour main.js/
                               preload.js (require()).
  i18n-web.ts                  Même lookup en ESM/TypeScript, pour
                               React/Vite (import).
  i18n-browser.js (dans src/presentation/pages/javascript/)
                               Même lookup en script classique, expose
                               window.I18n, pour renderer.js et
                               message-prive.js (pas de require(), pas de
                               bundler — voir "Piège n°2").
  → Trois implémentations de la MÊME petite fonction, une par
    environnement de module du projet. C'est voulu, pas de la dette :
    voir le commentaire en tête de chaque fichier. Ne jamais essayer de
    les fusionner en un seul fichier partagé — ça a déjà cassé le build
    de prod une fois (Rollup traite les .js source comme de l'ESM, pas
    du CommonJS).

src/presentation/pages/
  connexion/                   Page React (Vite root). LoginPage.tsx ne
                                stocke JAMAIS de texte déjà traduit dans
                                son état — seulement des clés/codes,
                                traduits au RENDU avec la langue courante
                                (voir "Piège n°3").
  index.html + javascript/salons/*.js + renderer.js
                                Dashboard (salons) : scripts classiques qui
                                partagent la portée globale, chargés dans
                                l'ordre d'index.html ; renderer.js (le
                                dernier) démarre la page. Seules des
                                DÉFINITIONS et des abonnements au niveau
                                supérieur des fichiers salons/*.js : rien ne
                                doit s'y exécuter au chargement (voir
                                salons.chargement.test.ts).
  javascript/logique-interface.js
                                Logique pure des pages de chat, testée à
                                100 % : y mettre toute règle testable
                                (fusion, défilement, tris…).
  message-prive.html + javascript/message-prive.js
                                Page des messages privés (DM).
  javascript/notif-prefs.js    Préférences de notification, partagées
                                entre les deux pages JS vanilla via
                                window.NotifPrefs (même pattern que
                                window.I18n). Chargé AVANT renderer.js/
                                message-prive.js dans le HTML — comme
                                i18n-browser.js et chat-ui-shared.js :
                                l'ordre des <script> compte, ce sont des
                                scripts classiques (pas des modules), qui
                                partagent le même scope global.
  javascript/chat-ui-shared.js Logique réseau/présence partagée entre
                                les deux pages, expose window.ChatUiShared
                                (même pattern que window.I18n/NotifPrefs).
```

## Pièges connus — déjà arrivés plusieurs fois, à vérifier explicitement

Ces régressions se sont TOUTES produites au moins une fois dans
l'historique de ce projet, généralement après un merge ou une copie
manuelle de fichiers entre collaborateurs. Un agent qui touche à ces
zones doit vérifier activement qu'il n'en réintroduit pas une.

1. **`index.html` et `message-prive.html` sont deux fichiers différents.**
   Ils se sont déjà retrouvés strictement identiques (l'un écrasé par une
   copie de l'autre) — après connexion, l'app chargeait alors l'interface
   des messages privés au lieu du dashboard des salons. Si l'un des deux
   fichiers semble étrangement similaire à l'autre, ou si `index.html` ne
   charge plus `renderer.js`, c'est ce bug.

2. **`renderer.js` et `message-prive.js` n'ont jamais accès à `require()`**
   (`nodeIntegration: false`). Toute donnée venant du processus main doit
   passer par `window.electronAPI.*` (IPC), jamais par un `require()`
   direct d'un fichier de `src/`. `tsc` et le serveur de dev Vite ne
   détectent PAS cette erreur (ils ne s'appliquent pas à ces fichiers) ;
   seul un lancement réel de l'app le révèle (`window.NotifPrefs`/
   `window.I18n` undefined, plantage silencieux).

3. **Ne jamais stocker un texte déjà traduit dans un état React/JS qui
   survit à un changement de langue** (ex. un message d'erreur affiché).
   Stocker la clé ou le code brut, traduire à chaque rendu/affichage avec
   `t(langueActuelle, ...)`. Sinon, changer de langue après coup ne
   retraduit jamais ce qui est déjà affiché.

4. **`RealGatewayRuntime.js` doit lever des CODES, jamais du texte
   français en dur** (`throw new Error('ERR_XXX')`, pas
   `throw new Error('Une erreur en français')`). La traduction se fait à
   la frontière IPC/UI (voir `messageErreur()` dans `i18n-browser.js`, ou
   l'équivalent dans `main.tsx`), jamais dans la couche métier — qui ne
   doit pas connaître la langue de l'utilisateur.

5. **`sessionStorage` ne survit pas de façon fiable à une navigation
   `file://` entre deux pages différentes** (`index.html` →
   `message-prive.html`). Pour tout ce qui doit survivre à cette
   navigation (identité de l'utilisateur connecté, langue...), utiliser
   un état côté processus main exposé via IPC (voir
   `session:utilisateur-connecte`, `langue:obtenir`), pas seulement
   `sessionStorage`.

6. **Fichiers de config qui reviennent en arrière** : `package.json`
   (version de `vitest`/`@vitest/coverage-v8` — doit matcher la version de
   `vite` installée, sinon deux copies de `vite` s'installent et `tsc`
   plante), `.eslintrc.js` (`ignorePatterns` doit exclure `dist/`), et
   `ChatGateway.ts` (a déjà perdu `pseudoDisponible` plusieurs fois). Si
   `npx tsc --noEmit` échoue avec une erreur de type Vite/Vitest
   incohérente, vérifier `npm ls vite` en premier.

7. **Barre de titre : deux copies du style.** `.app-titlebar` et
   `--titlebar-*` sont définis dans `styles.css` (pages vanilla) ET dans
   `connexion.css` (page React, bundle Vite séparé) : toute modification
   doit être faite dans les deux. Tout élément `position: fixed` en haut de
   page doit tenir compte de `--titlebar-height`.

8. **Contenu traduit du serveur par défaut.** `SALONS_PAR_DEFAUT` et
   `MESSAGE_BIENVENUE_ID` (`logique-interface.js`) reprennent les identifiants figés
   de Room-Service/Message-Service et les noms d'origine (`annonces`,
   `général`). Si une migration backend change ces noms ou le texte de
   bienvenue, mettre à jour ces constantes et
   `channels.welcomeMessage` (fr + en) dans `translations.json`.

9. **Thème : uniquement depuis la page profil.** Ne pas réintroduire de
   sélecteur de thème sur les écrans de connexion/inscription. La langue,
   elle, reste choisie à la connexion et est enregistrée dans le profil
   (`apresOuvertureSessionAvecLangueChoisie` dans `main.js`).

10. **`clamp(min, préféré, max)` avec `min > max`** est déjà arrivé dans
    `connexion.css` (`clamp(15px, 0.75vw, 13px)`) — invalide silencieusement
    en CSS, pas d'erreur, juste un rendu cassé.

Ces régressions reviennent parce que plusieurs personnes éditent les mêmes
fichiers sans toujours repartir de la dernière version poussée. Avant de
merger un travail issu d'une copie locale, vérifier qu'aucun marqueur de
conflit Git (`<<<<<<<`, `=======`, `>>>>>>>`) ne traîne dans le diff.

## Conventions

- Noms de variables, fonctions et commentaires : **en français**, dans
  tout le code (TS et JS). Les clés de traduction elles-mêmes sont en
  anglais (`auth.invalidFormat`, `errors.ERR_PSEUDO_PRIS`).
- Aucun texte d'UI en dur dans un composant ou un template — toujours via
  `t(langue, 'cle')`. Pour le HTML statique des pages vanilla, utiliser
  les attributs `data-i18n` / `data-i18n-title` / `data-i18n-aria-label` /
  `data-i18n-placeholder`, retraduits par `appliquerTraductionsStatiques()`.
- Toute nouvelle clé de traduction va dans `src/i18n/translations.json`,
  sous les DEUX langues (`fr` et `en`) — jamais une clé dans une seule.
- Toute nouvelle erreur métier dans `RealGatewayRuntime.js` : un code
  stable (`ERR_NOUVELLE_ERREUR`, éventuellement `ERR_X|param`), plus les
  deux traductions correspondantes dans `translations.json` sous
  `errors.*`.
- `localStorage`/`sessionStorage` : uniquement pour des préférences
  purement locales à UNE page (ex. `NotifPrefs`), jamais pour de l'état
  qui doit survivre à une navigation entre pages — voir Piège n°5.
